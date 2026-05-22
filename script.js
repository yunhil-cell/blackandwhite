import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, remove, get } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-database.js";
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
let mySubmittedNumber = null;

// 1. 초기 타일 덱 생성 (1~9)
function createMyDeck() {
    const deckEl = document.getElementById('my-deck');
    deckEl.innerHTML = '';
    for (let i = 1; i <= 9; i++) {
        const tile = document.createElement('div');
        tile.className = `deck-tile ${i % 2 === 0 ? 'black' : 'white'}`;
        tile.innerText = i;
        tile.dataset.num = i;
        tile.onclick = () => submitTile(i, tile);
        deckEl.appendChild(tile);
    }
}

// 2. 랜덤 코드 방 생성 및 참여 로직
async function enterGame(roomCode, isCreating) {
    myNickname = document.getElementById('nickname').value;
    if (!myNickname) return alert("팀명을 입력하세요!");

    try {
        const roomRef = ref(db, `${DB_ROOT}/${roomCode}`);
        const roomSnapshot = await get(roomRef);
        const roomData = roomSnapshot.val();

        if (isCreating) {
            if (roomData) return alert("이미 존재하는 방 코드입니다. 다시 시도하세요.");
        } else {
            if (!roomData) return alert("존재하지 않는 입장 코드입니다.");
            if (roomData.status === 'playing' || roomData.status === 'result') return alert("⚠️ 이미 진행 중인 게임입니다.");
            const playerCount = roomData.players ? Object.keys(roomData.players).length : 0;
            if (playerCount >= 2) return alert("🚫 방이 가득 찼습니다.");
        }

        currentRoom = roomCode;
        const userCred = await signInAnonymously(auth);
        myUid = userCred.user.uid;

        await set(ref(db, `${DB_ROOT}/${currentRoom}/players/${myUid}`), {
            nickname: myNickname,
            score: 0,
            submittedTile: null,
            isReady: false
        });

        if (isCreating) {
            await set(ref(db, `${DB_ROOT}/${currentRoom}/status`), 'setup');
        }

        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
        document.getElementById('display-room').innerText = `코드: ${currentRoom}`;
        document.getElementById('display-name').innerText = myNickname;
        
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
    
    // DB에 없는 유일한 코드가 나올 때까지 루프
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
    if (mySubmittedNumber !== null) return;
    
    tileEl.classList.add('used');
    mySubmittedNumber = num;

    const myPlayedEl = document.getElementById('my-played-tile');
    myPlayedEl.className = `tile ${num % 2 === 0 ? 'black' : 'white'}`;
    myPlayedEl.innerText = num;
    document.getElementById('game-info').innerText = "상대방의 선택을 기다리는 중...";

    await update(ref(db, `${DB_ROOT}/${currentRoom}/players/${myUid}`), {
        submittedTile: num
    });

    checkRoundReady();
}

async function checkRoundReady() {
    const snapshot = await get(ref(db, `${DB_ROOT}/${currentRoom}/players`));
    const players = snapshot.val();
    const pIds = Object.keys(players);
    
    if (pIds.length === 2 && players[pIds[0]].submittedTile !== null && players[pIds[1]].submittedTile !== null) {
        if (pIds[0] === myUid) {
            judgeRound(players, pIds);
        }
    }
}

// 4. 승패 판정 로직 (1은 9를 이긴다)
async function judgeRound(players, pIds) {
    const p1Num = players[pIds[0]].submittedTile;
    const p2Num = players[pIds[1]].submittedTile;
    let winnerId = null;

    if (p1Num === p2Num) {
        // 무승부
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
    
    let nextStatus = 'result';
    if (newP1Score >= 5 || newP2Score >= 5) {
        nextStatus = 'finished'; 
    }

    const updates = {};
    updates[`${DB_ROOT}/${currentRoom}/status`] = nextStatus;
    updates[`${DB_ROOT}/${currentRoom}/lastWinner`] = winnerId;
    updates[`${DB_ROOT}/${currentRoom}/tileP1`] = p1Num;
    updates[`${DB_ROOT}/${currentRoom}/tileP2`] = p2Num;
    updates[`${DB_ROOT}/${currentRoom}/p1Id`] = pIds[0];
    updates[`${DB_ROOT}/${currentRoom}/p2Id`] = pIds[1];
    updates[`${DB_ROOT}/${currentRoom}/players/${pIds[0]}/score`] = newP1Score;
    updates[`${DB_ROOT}/${currentRoom}/players/${pIds[1]}/score`] = newP2Score;

    await update(ref(db), updates);
}

// 5. 다음 라운드 준비 버튼
document.getElementById('ready-btn').onclick = async () => {
    document.getElementById('ready-btn').classList.add('hidden');
    document.getElementById('round-result').innerText = '';
    
    document.getElementById('my-played-tile').className = 'tile unknown';
    document.getElementById('my-played-tile').innerText = '?';
    document.getElementById('enemy-tile').className = 'tile unknown';
    document.getElementById('enemy-tile').innerText = '?';
    mySubmittedNumber = null;

    await update(ref(db, `${DB_ROOT}/${currentRoom}/players/${myUid}`), {
        isReady: true,
        submittedTile: null
    });

    checkNextRoundStart();
};

async function checkNextRoundStart() {
    const snapshot = await get(ref(db, `${DB_ROOT}/${currentRoom}/players`));
    const players = snapshot.val();
    const pIds = Object.keys(players);
    
    if (pIds.every(id => players[id].isReady)) {
        if (pIds[0] === myUid) {
            await update(ref(db, `${DB_ROOT}/${currentRoom}`), { status: 'playing' });
            await update(ref(db, `${DB_ROOT}/${currentRoom}/players/${pIds[0]}`), { isReady: false });
            await update(ref(db, `${DB_ROOT}/${currentRoom}/players/${pIds[1]}`), { isReady: false });
        }
    }
}

// 6. 실시간 동기화 (화면 표시)
function listenToRoom() {
    onValue(ref(db, `${DB_ROOT}/${currentRoom}`), (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            location.reload();
            return;
        }

        const info = document.getElementById('game-info');
        const enemyEl = document.getElementById('enemy-tile');
        const pIds = data.players ? Object.keys(data.players) : [];
        const enemyId = pIds.find(id => id !== myUid);

        // 6-1. 대기 중
        if (data.status === 'setup') {
            if (pIds.length < 2) {
                info.innerText = "상대방의 입장을 기다리는 중...";
            } else {
                const enemyName = data.players[enemyId].nickname;
                info.innerText = `${enemyName}님이 입장했습니다! 타일을 내세요.`;
            }
        } 
        // 6-2. 진행 중
        else if (data.status === 'playing') {
            if (mySubmittedNumber === null) {
                info.innerText = "이번 라운드에 낼 타일을 선택하세요.";
            } else {
                info.innerText = "상대방을 기다리는 중...";
            }
            
            if (enemyId && data.players[enemyId].submittedTile !== null) {
                const enemyNum = data.players[enemyId].submittedTile;
                enemyEl.className = `tile ${enemyNum % 2 === 0 ? 'black' : 'white'}`;
                enemyEl.innerText = '?';
            } else {
                enemyEl.className = 'tile unknown';
                enemyEl.innerText = '?';
            }
        }
        // 6-3. 결과 판정 및 최종 종료
        else if (data.status === 'result' || data.status === 'finished') {
            const enemyNum = (data.p1Id === enemyId) ? data.tileP1 : data.tileP2;
            enemyEl.className = `tile ${enemyNum % 2 === 0 ? 'black' : 'white'}`;
            enemyEl.innerText = enemyNum;
            
            myScore = data.players[myUid].score || 0;
            document.getElementById('my-score').innerText = myScore;

            const resEl = document.getElementById('round-result');
            
            if (data.lastWinner === myUid) {
                resEl.innerText = "🎉 이번 라운드 승리!";
                resEl.className = "round-result-msg win-text";
                document.body.classList.add('hit-flash');
                setTimeout(() => document.body.classList.remove('hit-flash'), 200);
                if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            } else if (data.lastWinner === null) {
                resEl.innerText = "🤝 무승부!";
                resEl.className = "round-result-msg draw-text";
            } else {
                resEl.innerText = "💥 이번 라운드 패배...";
                resEl.className = "round-result-msg lose-text";
                document.body.classList.add('screen-shake');
                setTimeout(() => document.body.classList.remove('screen-shake'), 400);
                if (navigator.vibrate) navigator.vibrate(300);
            }

            // 5점 도달 시 최종 방폭 처리
            if (data.status === 'finished') {
                if (data.lastWinner === myUid) {
                    info.innerText = "🏆 최종 승리!!! (5초 뒤 대기실 이동)";
                } else {
                    info.innerText = "💀 최종 패배... (5초 뒤 대기실 이동)";
                }
                document.getElementById('ready-btn').classList.add('hidden');
                
                if (data.lastWinner === myUid) {
                    setTimeout(() => {
                        remove(ref(db, `${DB_ROOT}/${currentRoom}`));
                    }, 5000);
                }
            } else {
                info.innerText = "결과 공개!";
                document.getElementById('ready-btn').classList.remove('hidden');
            }
        }
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