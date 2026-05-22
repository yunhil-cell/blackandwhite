import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, remove, get, runTransaction } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";

// [주의] 실제 API 키로 교체하세요!
const firebaseConfig = {
  apiKey: "AIzaSyAzDc8nErqYcYYy-itp2Tk9WZExy3PBlIU",
  authDomain: "battleship-f08f8.firebaseapp.com",
  databaseURL: "https://battleship-f08f8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "battleship-f08f8",
  storageBucket: "battleship-f08f8.firebasestorage.app",
  messagingSenderId: "1146329001",
  appId: "1:1146329001:web:f2d698e5661582ee1f96b8"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

const DB_ROOT = 'blackandwhite';

let myUid, myNickname, currentRoom;
let myScore = 0;
let mySubmittedNumber = 0;
let currentStatus = 'setup';
let latestRoomData = null;
let isJudging = false;
let isStartingNextRound = false;
let finishHandled = false;
let lastEffectKey = '';

// 1. 초기 타일 덱 생성 (1~9)
function createMyDeck() {
    const deckEl = document.getElementById('my-deck');
    deckEl.innerHTML = '';

    const row1 = document.createElement('div');
    row1.className = 'deck-row';

    const row2 = document.createElement('div');
    row2.className = 'deck-row';

    for (let i = 1; i <= 9; i++) {
        const tile = document.createElement('div');
        tile.className = `deck-tile ${i % 2 === 0 ? 'black' : 'white'}`;
        tile.innerText = i;
        tile.dataset.num = i;
        tile.onclick = () => submitTile(i, tile);

        if (i <= 5) {
            row1.appendChild(tile);
        } else {
            row2.appendChild(tile);
        }
    }

    deckEl.appendChild(row1);
    deckEl.appendChild(row2);
}

function syncDeckUsedTiles(player) {
    const usedTiles = player && player.usedTiles ? player.usedTiles : {};

    document.querySelectorAll('.deck-tile').forEach(tile => {
        const num = Number(tile.dataset.num);
        if (usedTiles[num]) {
            tile.classList.add('used');
        } else {
            tile.classList.remove('used');
        }
    });
}

function renderTile(tileEl, num, hideNumber = false) {
    const safeNum = Number(num || 0);

    if (safeNum > 0) {
        tileEl.className = `tile ${safeNum % 2 === 0 ? 'black' : 'white'}`;
        tileEl.innerText = hideNumber ? '?' : safeNum;
    } else {
        tileEl.className = 'tile unknown';
        tileEl.innerText = '?';
    }
}

function hasSubmitted(player) {
    return Number(player && player.submittedTile ? player.submittedTile : 0) > 0;
}

function getUsedTileCount(player) {
    if (!player || !player.usedTiles) return 0;
    return Object.keys(player.usedTiles).length;
}

function getPlayerName(data, id) {
    if (!data || !data.players || !data.players[id]) return "상대방";
    return data.players[id].nickname || "상대방";
}

function getOrderText(data, id) {
    if (!data || !id) return "";
    if (data.firstPlayerId === id) return "선공";
    if (data.secondPlayerId === id) return "후공";
    return "";
}

function setTurnVisual(isMyTurn) {
    const gameScreen = document.getElementById('game-screen');
    const info = document.getElementById('game-info');
    const deck = document.getElementById('my-deck');

    document.body.classList.toggle('my-turn-active', isMyTurn);
    gameScreen.classList.toggle('turn-glow', isMyTurn);
    info.classList.toggle('my-turn-info', isMyTurn);
    deck.classList.toggle('deck-disabled', !isMyTurn && currentStatus === 'playing');
}

// 2. 랜덤 코드 방 생성 및 참여 로직
async function enterGame(roomCode, isCreating) {
    myNickname = document.getElementById('nickname').value.trim();
    if (!myNickname) return alert("팀명을 입력하세요!");

    try {
        const roomRef = ref(db, `${DB_ROOT}/${roomCode}`);
        const roomSnapshot = await get(roomRef);
        const roomData = roomSnapshot.val();

        if (isCreating) {
            if (roomData) return alert("이미 존재하는 방 코드입니다. 다시 시도하세요.");
        } else {
            if (!roomData) return alert("존재하지 않는 입장 코드입니다.");
            if (['playing', 'result', 'judging', 'starting', 'finished'].includes(roomData.status)) {
                return alert("⚠️ 이미 진행 중인 게임입니다.");
            }

            const playerCount = roomData.players ? Object.keys(roomData.players).length : 0;
            if (playerCount >= 2) return alert("🚫 방이 가득 찼습니다.");
        }

        currentRoom = roomCode;
        const userCred = await signInAnonymously(auth);
        myUid = userCred.user.uid;

        await set(ref(db, `${DB_ROOT}/${currentRoom}/players/${myUid}`), {
            nickname: myNickname,
            score: 0,
            submittedTile: 0,
            isReady: false,
            usedTiles: {}
        });

        if (isCreating) {
            await update(ref(db, `${DB_ROOT}/${currentRoom}`), {
                status: 'setup',
                createdAt: Date.now()
            });
        }

        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
        document.getElementById('display-room').innerText = `코드: ${currentRoom}`;
        document.getElementById('display-name').innerText = myNickname;

        myScore = 0;
        mySubmittedNumber = 0;
        currentStatus = 'setup';
        latestRoomData = null;
        isJudging = false;
        isStartingNextRound = false;
        finishHandled = false;
        lastEffectKey = '';
        
        createMyDeck();
        listenToRoom();
    } catch (error) {
        console.error("접속 중 에러 발생:", error);
        alert("접속 실패! 네트워크를 확인하세요.");
    }
}

document.getElementById('create-room-btn').onclick = async () => {
    let uniqueCode = "";
    let isUnique = false;
    
    while (!isUnique) {
        const randomCode = Math.floor(1000 + Math.random() * 9000).toString();
        const roomSnapshot = await get(ref(db, `${DB_ROOT}/${randomCode}`));
        if (!roomSnapshot.exists()) {
            uniqueCode = randomCode;
            isUnique = true;
        }
    }

    enterGame(uniqueCode, true);
};

document.getElementById('join-room-btn').onclick = () => {
    const codeInput = document.getElementById('join-code').value.trim();
    if (!codeInput) return alert("입장 코드를 입력하세요.");
    enterGame(codeInput, false);
};

// 3. 타일 제출 로직
async function submitTile(num, tileEl) {
    if (currentStatus !== 'playing') {
        alert("아직 타일을 낼 수 없습니다.");
        return;
    }

    if (!latestRoomData || latestRoomData.currentTurn !== myUid) {
        alert("아직 내 차례가 아닙니다.");
        return;
    }

    if (mySubmittedNumber > 0) return;

    const myPlayedEl = document.getElementById('my-played-tile');

    try {
        const roomSnapshot = await get(ref(db, `${DB_ROOT}/${currentRoom}`));
        const freshData = roomSnapshot.val();

        if (!freshData || freshData.status !== 'playing') {
            alert("현재 타일을 낼 수 없습니다.");
            return;
        }

        if (freshData.currentTurn !== myUid) {
            alert("아직 내 차례가 아닙니다.");
            return;
        }

        const freshPlayer = freshData.players ? freshData.players[myUid] : null;

        if (!freshPlayer) {
            alert("플레이어 정보를 찾을 수 없습니다.");
            return;
        }

        if (Number(freshPlayer.submittedTile || 0) > 0) return;

        if (freshPlayer.usedTiles && freshPlayer.usedTiles[num]) {
            alert("이미 사용한 타일입니다.");
            return;
        }

        const firstId = freshData.firstPlayerId;
        const secondId = freshData.secondPlayerId;
        const nextTurn = myUid === firstId ? secondId : '';

        tileEl.classList.add('used');
        mySubmittedNumber = num;

        renderTile(myPlayedEl, num);
        setTurnVisual(false);

        if (nextTurn) {
            document.getElementById('game-info').innerText = "타일 제출 완료. 상대방 차례입니다.";
        } else {
            document.getElementById('game-info').innerText = "타일 제출 완료. 결과 판정 중...";
        }

        const updates = {};
        updates[`${DB_ROOT}/${currentRoom}/players/${myUid}/submittedTile`] = num;
        updates[`${DB_ROOT}/${currentRoom}/players/${myUid}/usedTiles/${num}`] = true;
        updates[`${DB_ROOT}/${currentRoom}/currentTurn`] = nextTurn || '';

        await update(ref(db), updates);
    } catch (error) {
        console.error("타일 제출 실패:", error);
        tileEl.classList.remove('used');
        mySubmittedNumber = 0;
        renderTile(myPlayedEl, 0);
        alert("타일 제출에 실패했습니다. 다시 시도하세요.");
    }
}

// 첫 라운드 선후공 무작위 결정
async function tryStartFirstRound(data, pIds) {
    if (data.status !== 'setup') return;
    if (pIds.length !== 2) return;

    try {
        const statusRef = ref(db, `${DB_ROOT}/${currentRoom}/status`);
        const txResult = await runTransaction(statusRef, status => {
            if (status === 'setup') return 'starting';
            return;
        });

        if (txResult.committed && txResult.snapshot.val() === 'starting') {
            const firstId = Math.random() < 0.5 ? pIds[0] : pIds[1];
            const secondId = pIds.find(id => id !== firstId);

            await update(ref(db, `${DB_ROOT}/${currentRoom}`), {
                status: 'playing',
                firstPlayerId: firstId,
                secondPlayerId: secondId,
                currentTurn: firstId,
                roundNo: 1
            });
        }
    } catch (error) {
        console.error("첫 라운드 시작 중 에러:", error);
        await update(ref(db, `${DB_ROOT}/${currentRoom}`), { status: 'setup' }).catch(console.error);
    }
}

async function tryJudgeRound(data, pIds) {
    if (isJudging) return;
    if (data.status !== 'playing') return;
    if (pIds.length !== 2) return;

    const bothSubmitted = pIds.every(id => hasSubmitted(data.players[id]));
    if (!bothSubmitted) return;

    isJudging = true;

    try {
        const statusRef = ref(db, `${DB_ROOT}/${currentRoom}/status`);
        const txResult = await runTransaction(statusRef, status => {
            if (status === 'playing') return 'judging';
            return;
        });

        if (txResult.committed && txResult.snapshot.val() === 'judging') {
            await judgeRound(data.players, pIds);
        }
    } catch (error) {
        console.error("라운드 판정 중 에러:", error);
        await update(ref(db, `${DB_ROOT}/${currentRoom}`), { status: 'playing' });
    } finally {
        isJudging = false;
    }
}

// 4. 승패 판정 로직 (1은 9를 이긴다)
async function judgeRound(players, pIds) {
    const p1Num = Number(players[pIds[0]].submittedTile || 0);
    const p2Num = Number(players[pIds[1]].submittedTile || 0);
    let winnerId = 'draw';

    if (p1Num === p2Num) {
        winnerId = 'draw';
    } else if (p1Num === 1 && p2Num === 9) {
        winnerId = pIds[0];
    } else if (p1Num === 9 && p2Num === 1) {
        winnerId = pIds[1];
    } else if (p1Num > p2Num) {
        winnerId = pIds[0];
    } else {
        winnerId = pIds[1];
    }

    const p1Score = players[pIds[0]].score || 0;
    const p2Score = players[pIds[1]].score || 0;
    const newP1Score = winnerId === pIds[0] ? p1Score + 1 : p1Score;
    const newP2Score = winnerId === pIds[1] ? p2Score + 1 : p2Score;
    const allTilesUsed = pIds.every(id => getUsedTileCount(players[id]) >= 9);
    
    let nextStatus = 'result';
    let gameWinner = '';

    if (newP1Score >= 5 || newP2Score >= 5) {
        nextStatus = 'finished';
        gameWinner = newP1Score > newP2Score ? pIds[0] : pIds[1];
    } else if (allTilesUsed) {
        nextStatus = 'finished';

        if (newP1Score > newP2Score) {
            gameWinner = pIds[0];
        } else if (newP2Score > newP1Score) {
            gameWinner = pIds[1];
        } else {
            gameWinner = 'draw';
        }
    }

    const updates = {};
    updates[`${DB_ROOT}/${currentRoom}/status`] = nextStatus;
    updates[`${DB_ROOT}/${currentRoom}/currentTurn`] = '';
    updates[`${DB_ROOT}/${currentRoom}/lastWinner`] = winnerId;
    updates[`${DB_ROOT}/${currentRoom}/gameWinner`] = gameWinner;
    updates[`${DB_ROOT}/${currentRoom}/tileP1`] = p1Num;
    updates[`${DB_ROOT}/${currentRoom}/tileP2`] = p2Num;
    updates[`${DB_ROOT}/${currentRoom}/p1Id`] = pIds[0];
    updates[`${DB_ROOT}/${currentRoom}/p2Id`] = pIds[1];
    updates[`${DB_ROOT}/${currentRoom}/players/${pIds[0]}/score`] = newP1Score;
    updates[`${DB_ROOT}/${currentRoom}/players/${pIds[1]}/score`] = newP2Score;

    await update(ref(db), updates);
}

// 5. 다음 라운드 준비 버튼
async function tryStartNextRound(data, pIds) {
    if (isStartingNextRound) return;
    if (data.status !== 'result') return;
    if (pIds.length !== 2) return;

    const bothReady = pIds.every(id => data.players[id] && data.players[id].isReady === true);
    if (!bothReady) return;

    isStartingNextRound = true;

    try {
        const statusRef = ref(db, `${DB_ROOT}/${currentRoom}/status`);
        const txResult = await runTransaction(statusRef, status => {
            if (status === 'result') return 'starting';
            return;
        });

        if (txResult.committed && txResult.snapshot.val() === 'starting') {
            let nextFirstId = data.firstPlayerId || pIds[0];
            let nextSecondId = data.secondPlayerId || pIds.find(id => id !== nextFirstId);

            // 전판 승자가 있으면 승자가 다음 라운드 선공
            if (data.lastWinner && data.lastWinner !== 'draw') {
                nextFirstId = data.lastWinner;
                nextSecondId = pIds.find(id => id !== nextFirstId);
            }

            // 전판 무승부면 기존 firstPlayerId / secondPlayerId 유지
            if (!nextSecondId) return;

            const updates = {};
            updates[`${DB_ROOT}/${currentRoom}/status`] = 'playing';
            updates[`${DB_ROOT}/${currentRoom}/currentTurn`] = nextFirstId;
            updates[`${DB_ROOT}/${currentRoom}/firstPlayerId`] = nextFirstId;
            updates[`${DB_ROOT}/${currentRoom}/secondPlayerId`] = nextSecondId;
            updates[`${DB_ROOT}/${currentRoom}/lastWinner`] = '';
            updates[`${DB_ROOT}/${currentRoom}/gameWinner`] = '';
            updates[`${DB_ROOT}/${currentRoom}/tileP1`] = 0;
            updates[`${DB_ROOT}/${currentRoom}/tileP2`] = 0;
            updates[`${DB_ROOT}/${currentRoom}/p1Id`] = '';
            updates[`${DB_ROOT}/${currentRoom}/p2Id`] = '';
            updates[`${DB_ROOT}/${currentRoom}/roundNo`] = (data.roundNo || 1) + 1;

            pIds.forEach(id => {
                updates[`${DB_ROOT}/${currentRoom}/players/${id}/isReady`] = false;
                updates[`${DB_ROOT}/${currentRoom}/players/${id}/submittedTile`] = 0;
            });

            await update(ref(db), updates);
        }
    } catch (error) {
        console.error("다음 라운드 시작 중 에러:", error);
        await update(ref(db, `${DB_ROOT}/${currentRoom}`), { status: 'result' });
    } finally {
        isStartingNextRound = false;
    }
}

document.getElementById('ready-btn').onclick = async () => {
    if (currentStatus !== 'result') return;

    document.getElementById('ready-btn').classList.add('hidden');
    document.getElementById('game-info').innerText = "상대방의 준비를 기다리는 중...";

    try {
        await update(ref(db, `${DB_ROOT}/${currentRoom}/players/${myUid}`), {
            isReady: true,
            submittedTile: 0
        });
    } catch (error) {
        console.error("준비 처리 실패:", error);
        alert("준비 처리에 실패했습니다. 다시 시도하세요.");
        document.getElementById('ready-btn').classList.remove('hidden');
    }
};

// 6. 실시간 동기화 (화면 표시)
function listenToRoom() {
    onValue(ref(db, `${DB_ROOT}/${currentRoom}`), (snapshot) => {
        const data = snapshot.val();

        if (!data) {
            location.reload();
            return;
        }

        latestRoomData = data;
        currentStatus = data.status || 'setup';

        const info = document.getElementById('game-info');
        const enemyEl = document.getElementById('enemy-tile');
        const myPlayedEl = document.getElementById('my-played-tile');
        const readyBtn = document.getElementById('ready-btn');
        const resEl = document.getElementById('round-result');
        const pIds = data.players ? Object.keys(data.players) : [];
        const myPlayer = data.players ? data.players[myUid] : null;
        const enemyId = pIds.find(id => id !== myUid);
        const enemyPlayer = enemyId && data.players ? data.players[enemyId] : null;

        if (myPlayer) {
            myScore = myPlayer.score || 0;
            mySubmittedNumber = Number(myPlayer.submittedTile || 0);
            document.getElementById('my-score').innerText = myScore;
            syncDeckUsedTiles(myPlayer);
        }

        // 6-1. 대기 중
        if (currentStatus === 'setup') {
            setTurnVisual(false);
            readyBtn.classList.add('hidden');
            resEl.innerText = '';
            renderTile(myPlayedEl, 0);
            renderTile(enemyEl, 0);

            if (pIds.length < 2) {
                info.innerText = "상대방의 입장을 기다리는 중...";
            } else {
                info.innerText = "상대방이 입장했습니다. 선후공을 정하는 중...";
            }
        }

        // 6-2. 라운드 시작 준비 중
        else if (currentStatus === 'starting') {
            setTurnVisual(false);
            readyBtn.classList.add('hidden');
            info.innerText = "라운드를 준비하는 중...";
        }

        // 6-3. 진행 중
        else if (currentStatus === 'playing') {
            readyBtn.classList.add('hidden');
            resEl.innerText = '';

            const currentTurnId = data.currentTurn || '';
            const isMyTurn = currentTurnId === myUid && mySubmittedNumber === 0;
            const enemyNum = Number(enemyPlayer && enemyPlayer.submittedTile ? enemyPlayer.submittedTile : 0);
            const myOrderText = getOrderText(data, myUid);
            const myOrderLabel = myOrderText ? ` (${myOrderText})` : '';

            setTurnVisual(isMyTurn);

            if (mySubmittedNumber > 0) {
                renderTile(myPlayedEl, mySubmittedNumber);

                if (currentTurnId && currentTurnId !== myUid) {
                    const turnName = getPlayerName(data, currentTurnId);
                    const orderText = getOrderText(data, currentTurnId);
                    const orderLabel = orderText ? ` (${orderText})` : '';
                    info.innerText = `타일 제출 완료. ${turnName}님 차례입니다${orderLabel}.`;
                } else {
                    info.innerText = "타일 제출 완료. 결과 판정 중...";
                }
            } else if (isMyTurn) {
                renderTile(myPlayedEl, 0);
                info.innerText = `🔥 내 차례입니다${myOrderLabel}. 낼 타일을 선택하세요.`;
            } else if (currentTurnId) {
                renderTile(myPlayedEl, 0);

                const turnName = getPlayerName(data, currentTurnId);
                const orderText = getOrderText(data, currentTurnId);
                const orderLabel = orderText ? ` (${orderText})` : '';
                info.innerText = `⏳ ${turnName}님 차례입니다${orderLabel}. 기다리세요.`;
            } else {
                renderTile(myPlayedEl, 0);
                info.innerText = "결과 판정 중...";
            }

            // 상대가 제출한 경우 숫자는 숨기고 색만 표시
            renderTile(enemyEl, enemyNum, true);
        }

        // 6-4. 결과 판정 중
        else if (currentStatus === 'judging') {
            setTurnVisual(false);
            readyBtn.classList.add('hidden');
            info.innerText = "결과 판정 중...";

            if (mySubmittedNumber > 0) {
                renderTile(myPlayedEl, mySubmittedNumber);
            } else {
                renderTile(myPlayedEl, 0);
            }

            const enemyNum = Number(enemyPlayer && enemyPlayer.submittedTile ? enemyPlayer.submittedTile : 0);
            renderTile(enemyEl, enemyNum, true);
        }

        // 6-5. 결과 판정 및 최종 종료
        else if (currentStatus === 'result' || currentStatus === 'finished') {
            setTurnVisual(false);

            let myRoundNum = 0;
            let enemyRoundNum = 0;

            if (data.p1Id === myUid) myRoundNum = data.tileP1;
            if (data.p2Id === myUid) myRoundNum = data.tileP2;
            if (data.p1Id === enemyId) enemyRoundNum = data.tileP1;
            if (data.p2Id === enemyId) enemyRoundNum = data.tileP2;

            renderTile(myPlayedEl, myRoundNum);
            renderTile(enemyEl, enemyRoundNum);
            document.getElementById('my-score').innerText = myScore;

            const effectKey = `${data.p1Id || ''}-${data.p2Id || ''}-${data.tileP1 || 0}-${data.tileP2 || 0}-${data.lastWinner || ''}`;
            const shouldPlayEffect = lastEffectKey !== effectKey;

            if (shouldPlayEffect) {
                lastEffectKey = effectKey;
            }
            
            if (data.lastWinner === myUid) {
                resEl.innerText = "🎉 이번 라운드 승리!";
                resEl.className = "round-result-msg win-text";

                if (shouldPlayEffect) {
                    document.body.classList.add('hit-flash');
                    setTimeout(() => document.body.classList.remove('hit-flash'), 200);
                    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
                }
            } else if (data.lastWinner === 'draw') {
                resEl.innerText = "🤝 무승부!";
                resEl.className = "round-result-msg draw-text";
            } else {
                resEl.innerText = "💥 이번 라운드 패배...";
                resEl.className = "round-result-msg lose-text";

                if (shouldPlayEffect) {
                    document.body.classList.add('screen-shake');
                    setTimeout(() => document.body.classList.remove('screen-shake'), 400);
                    if (navigator.vibrate) navigator.vibrate(300);
                }
            }

            if (currentStatus === 'finished') {
                const gameWinner = data.gameWinner || data.lastWinner;

                if (gameWinner === myUid) {
                    info.innerText = "🏆 최종 승리!!! (5초 뒤 대기실 이동)";
                } else if (gameWinner === 'draw') {
                    info.innerText = "🤝 최종 무승부! (5초 뒤 대기실 이동)";
                } else {
                    info.innerText = "💀 최종 패배... (5초 뒤 대기실 이동)";
                }

                readyBtn.classList.add('hidden');
                
                if (!finishHandled) {
                    finishHandled = true;
                    setTimeout(() => {
                        remove(ref(db, `${DB_ROOT}/${currentRoom}`));
                    }, 5000);
                }
            } else {
                let nextFirstId = data.firstPlayerId;

                if (data.lastWinner && data.lastWinner !== 'draw') {
                    nextFirstId = data.lastWinner;
                }

                const nextFirstName = getPlayerName(data, nextFirstId);

                if (myPlayer && myPlayer.isReady) {
                    info.innerText = "준비 완료. 상대방의 준비를 기다리는 중...";
                    readyBtn.classList.add('hidden');
                } else {
                    if (data.lastWinner === 'draw') {
                        info.innerText = `결과 공개! 무승부라 선후공 유지. 다음 선공: ${nextFirstName}`;
                    } else {
                        info.innerText = `결과 공개! 다음 선공: ${nextFirstName}`;
                    }

                    readyBtn.classList.remove('hidden');
                }
            }
        }

        tryStartFirstRound(data, pIds).catch(console.error);
        tryJudgeRound(data, pIds).catch(console.error);
        tryStartNextRound(data, pIds).catch(console.error);
    });
}

// 7. 교사용 전체 초기화 버튼
document.getElementById('global-reset-btn').onclick = () => {
    const pw = document.getElementById('global-reset-pw').value;

    if (pw === "reset") {
        remove(ref(db, DB_ROOT));
        alert("모든 구룡투 결투장이 초기화되었습니다.");
    } else {
        alert("암호가 틀렸습니다.");
    }
};