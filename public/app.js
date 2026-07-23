const $ = (id) => document.getElementById(id);

const state = {
  roomCode: '',
  playerId: '',
  name: '',
  room: null,
  selectedIds: new Set(),
  source: null,
  chatTimer: null,
  dealTimer: null,
  bombTimer: null,
  lastDealRound: 0,
  lastBombSignature: '',
  hasRenderedRoom: false,
  lastCardClick: {
    id: '',
    ts: 0,
  },
  closingPage: false,
};

const roomInput = $('roomInput');
const nameInput = $('nameInput');
const joinScreen = $('joinScreen');
const gameShell = $('gameShell');
const joinBtn = $('joinBtn');
const joinTip = $('joinTip');
const statusText = $('statusText');
const roomBadge = $('roomBadge');
const copyLinkBtn = $('copyLinkBtn');
const leaveBtn = $('leaveBtn');
const phaseLabel = $('phaseLabel');
const turnLabel = $('turnLabel');
const landlordLabel = $('landlordLabel');
const comboLabel = $('comboLabel');
const playedByLabel = $('playedByLabel');
const playedCards = $('playedCards');
const baseScoreLabel = $('baseScoreLabel');
const multiplierLabel = $('multiplierLabel');
const settlementLabel = $('settlementLabel');
const scoreBoard = $('scoreBoard');
const centerPanel = $('centerPanel');
const bottomCards = $('bottomCards');
const dealAnimationLayer = $('dealAnimationLayer');
const bombAnimationLayer = $('bombAnimationLayer');
const hand = $('hand');
const handHint = $('handHint');
const myChatBubble = $('myChatBubble');
const actionBar = $('actionBar');
const seatLeft = $('seatLeft');
const seatRight = $('seatRight');
const chatForm = $('chatForm');
const chatInput = $('chatInput');

function loadSaved() {
  const queryRoom = new URLSearchParams(location.search).get('room') || '';
  const savedName = localStorage.getItem('ddz_name') || '';
  const savedRoom = queryRoom || localStorage.getItem('ddz_room') || '';
  const savedPlayerId = localStorage.getItem('ddz_playerId') || '';
  if (savedName) nameInput.value = savedName;
  if (savedRoom) roomInput.value = savedRoom;
  state.playerId = savedPlayerId;
  state.name = savedName;
  state.roomCode = savedRoom;
}

function setStatus(text) {
  statusText.textContent = text;
}

function setJoinTip(text) {
  joinTip.textContent = text;
}

function escapeRoomUrl(roomCode) {
  const url = new URL(location.href);
  url.searchParams.set('room', roomCode);
  return url.toString();
}

function clearSource() {
  if (state.source) {
    state.source.close();
    state.source = null;
  }
}

function closeBrowserPage() {
  if (state.closingPage) return;
  state.closingPage = true;
  clearSource();

  try {
    window.open('', '_self');
  } catch (error) {
    // ignore
  }
  window.close();
  window.setTimeout(() => {
    try {
      location.replace('about:blank');
    } catch (error) {
      // ignore
    }
  }, 120);
}

function requestRoomEscapeClose() {
  if (!state.room || !state.roomCode || !state.playerId || state.closingPage) return;

  const payload = JSON.stringify({
    roomCode: state.roomCode,
    playerId: state.playerId,
    action: 'escapeClose',
  });
  const beaconBody = new Blob([payload], { type: 'application/json' });

  if (!navigator.sendBeacon || !navigator.sendBeacon('/api/action', beaconBody)) {
    fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }

  closeBrowserPage();
}

function clearChatTimer() {
  if (state.chatTimer) {
    window.clearTimeout(state.chatTimer);
    state.chatTimer = null;
  }
}

function clearDealAnimation() {
  if (state.dealTimer) {
    window.clearTimeout(state.dealTimer);
    state.dealTimer = null;
  }
  dealAnimationLayer.innerHTML = '';
  dealAnimationLayer.classList.add('hidden');
  gameShell.classList.remove('dealing');
}

function clearBombAnimation() {
  if (state.bombTimer) {
    window.clearTimeout(state.bombTimer);
    state.bombTimer = null;
  }
  bombAnimationLayer.innerHTML = '';
  bombAnimationLayer.classList.add('hidden');
}

function resetLocalRoom(message = '已退出房间') {
  clearSource();
  clearChatTimer();
  clearDealAnimation();
  clearBombAnimation();
  state.roomCode = '';
  state.playerId = '';
  state.room = null;
  state.selectedIds.clear();
  state.lastDealRound = 0;
  state.lastBombSignature = '';
  state.lastCardClick = { id: '', ts: 0 };
  state.hasRenderedRoom = false;
  localStorage.removeItem('ddz_room');
  localStorage.removeItem('ddz_playerId');
  roomInput.value = '';
  roomBadge.textContent = '未加入';
  copyLinkBtn.dataset.share = '';
  copyLinkBtn.disabled = true;
  leaveBtn.classList.add('hidden');
  setStatus('等待加入房间');
  setJoinTip(message);
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  render();
}

function rankText(rank) {
  return {
    3: '3',
    4: '4',
    5: '5',
    6: '6',
    7: '7',
    8: '8',
    9: '9',
    10: '10',
    11: 'J',
    12: 'Q',
    13: 'K',
    14: 'A',
    15: '2',
    16: '小王',
    17: '大王',
  }[rank] || String(rank);
}

function suitColor(card) {
  if (card.rank >= 16) return 'joker';
  return card.suit === 'H' || card.suit === 'D' ? 'red' : 'black';
}

function cardDisplay(card) {
  return card.display || `${rankText(card.rank)}${card.suit || ''}`;
}

function suitSymbol(card) {
  return {
    S: '♠',
    H: '♥',
    C: '♣',
    D: '♦',
    SJ: '☆',
    BJ: '★',
  }[card.suit] || '';
}

function cardLabel(card) {
  return card.rank >= 16 ? (card.rank === 17 ? '大王' : '小王') : rankText(card.rank);
}

function cardFaceHtml(card, compact = false) {
  const label = escapeHtml(cardLabel(card));
  const suit = escapeHtml(suitSymbol(card));
  const centerText = card.rank >= 16 ? label : suit;
  const extraClass = compact ? ' compact' : '';
  return `
    <div class="card-corner top-left${extraClass}">
      <span class="card-rank">${label}</span>
      <span class="card-suit">${suit}</span>
    </div>
    <div class="card-face-center${extraClass}">
      <span>${centerText}</span>
    </div>
    <div class="card-corner bottom-right${extraClass}">
      <span class="card-rank">${label}</span>
      <span class="card-suit">${suit}</span>
    </div>
  `;
}

function suitOrder(card) {
  return {
    S: 0,
    H: 1,
    C: 2,
    D: 3,
    SJ: 4,
    BJ: 5,
  }[card.suit] ?? 99;
}

function displaySortedCards(cards) {
  return (cards || []).slice().sort((a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank;
    return suitOrder(a) - suitOrder(b);
  });
}

function playerBySeat(seat) {
  return state.room?.players?.find((player) => player && player.seat === seat) || null;
}

function playerNameBySeat(seat) {
  const player = playerBySeat(seat);
  return player ? player.name : '空位';
}

function turnName(seat) {
  if (seat === null || seat === undefined || seat < 0) return '-';
  return playerNameBySeat(seat);
}

function currentSeatPlayerName(seat) {
  return turnName(seat);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function activeChatMessages(room = state.room) {
  const now = Date.now();
  return (room?.chatMessages || []).filter((message) => message.expiresAt > now);
}

function latestChatBySeat(seat) {
  const messages = activeChatMessages().filter((message) => message.seat === seat);
  return messages.length ? messages[messages.length - 1] : null;
}

function scheduleChatExpiry() {
  clearChatTimer();
  const messages = activeChatMessages();
  if (!messages.length) return;
  const nextExpiry = Math.min(...messages.map((message) => message.expiresAt));
  const delay = Math.max(0, nextExpiry - Date.now() + 30);
  state.chatTimer = window.setTimeout(() => {
    state.chatTimer = null;
    render();
  }, delay);
}

function shouldStartDealAnimation(room) {
  if (!room || room.round <= 0 || room.phase === 'waiting' || room.phase === 'ended') return false;
  if (!state.hasRenderedRoom) {
    state.lastDealRound = room.round;
    return false;
  }
  if (state.lastDealRound === room.round) return false;
  state.lastDealRound = room.round;
  return true;
}

function bombSignature(room) {
  const combo = room?.currentCombo;
  if (!combo || (combo.type !== 'bomb' && combo.type !== 'rocket')) return '';
  return [
    room.round,
    room.lastPlaySeat,
    combo.type,
    combo.mainRank,
    combo.cardCount,
    combo.groupCount || '',
  ].join(':');
}

function shouldStartBombAnimation(room) {
  const signature = bombSignature(room);
  if (!signature) return false;
  if (!state.hasRenderedRoom) {
    state.lastBombSignature = signature;
    return false;
  }
  if (state.lastBombSignature === signature) return false;
  state.lastBombSignature = signature;
  return true;
}

function elementCenter(node, fallback) {
  const rect = node?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return fallback;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function playDealAnimation() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  clearDealAnimation();
  const start = elementCenter(centerPanel, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const targets = [
    elementCenter(seatLeft, start),
    elementCenter(hand, start),
    elementCenter(seatRight, start),
  ];

  dealAnimationLayer.classList.remove('hidden');
  gameShell.classList.add('dealing');

  const dealt = [0, 0, 0];
  const totalCards = 42;
  const duration = 620;
  const gap = 32;
  let longest = 0;

  for (let index = 0; index < totalCards; index += 1) {
    const targetIndex = index % 3;
    const target = targets[targetIndex];
    const slot = dealt[targetIndex];
    dealt[targetIndex] += 1;

    const card = document.createElement('div');
    card.className = 'deal-card';
    card.style.left = `${start.x}px`;
    card.style.top = `${start.y}px`;
    dealAnimationLayer.appendChild(card);

    const jitterX = ((slot % 5) - 2) * 10;
    const jitterY = (Math.floor(slot / 5) - 1) * 6;
    const dx = target.x - start.x + jitterX;
    const dy = target.y - start.y + jitterY;
    const delay = index * gap;
    const rotate = (targetIndex - 1) * 10 + ((slot % 3) - 1) * 4;
    longest = Math.max(longest, delay + duration);

    card.animate(
      [
        {
          opacity: 0,
          transform: 'translate(-50%, -50%) scale(0.72) rotate(0deg)',
        },
        {
          opacity: 1,
          offset: 0.18,
          transform: 'translate(-50%, -50%) scale(0.88) rotate(0deg)',
        },
        {
          opacity: 0.12,
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.96) rotate(${rotate}deg)`,
        },
      ],
      {
        duration,
        delay,
        easing: 'cubic-bezier(0.2, 0.78, 0.2, 1)',
        fill: 'forwards',
      },
    );
  }

  state.dealTimer = window.setTimeout(() => {
    clearDealAnimation();
  }, longest + 180);
}

function playBombAnimation(type = 'bomb') {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  clearBombAnimation();
  const center = elementCenter(centerPanel, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const isRocket = type === 'rocket';
  const particleCount = isRocket ? 30 : 22;
  const duration = isRocket ? 1100 : 920;

  bombAnimationLayer.classList.remove('hidden');

  const burst = document.createElement('div');
  burst.className = `bomb-burst ${isRocket ? 'rocket' : ''}`;
  burst.style.left = `${center.x}px`;
  burst.style.top = `${center.y}px`;
  burst.innerHTML = `
    <div class="bomb-flash"></div>
    <div class="bomb-ring one"></div>
    <div class="bomb-ring two"></div>
    <div class="bomb-core">${isRocket ? '王炸' : '炸弹'}</div>
  `;
  bombAnimationLayer.appendChild(burst);

  for (let index = 0; index < particleCount; index += 1) {
    const spark = document.createElement('div');
    const angle = (Math.PI * 2 * index) / particleCount;
    const distance = (isRocket ? 160 : 125) + (index % 5) * 18;
    const size = 5 + (index % 4) * 2;
    spark.className = 'bomb-spark';
    spark.style.left = `${center.x}px`;
    spark.style.top = `${center.y}px`;
    spark.style.width = `${size}px`;
    spark.style.height = `${size}px`;
    spark.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    spark.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
    spark.style.animationDelay = `${(index % 6) * 12}ms`;
    bombAnimationLayer.appendChild(spark);
  }

  state.bombTimer = window.setTimeout(() => {
    clearBombAnimation();
  }, duration + 180);
}

function formatDelta(delta) {
  return `${delta >= 0 ? '+' : ''}${delta}`;
}

function renderSeat(node, seat, title, direction) {
  if (!seat || seat.empty) {
    node.innerHTML = '<div class="subtle">等待玩家加入</div>';
    node.classList.add('empty');
    return;
  }
  node.classList.remove('empty');
  const badgeBits = [];
  if (seat.isLandlord) badgeBits.push('<span class="badge landlord">地主</span>');
  if (seat.connected) badgeBits.push('<span class="badge live">在线</span>');
  if (seat.isYou) badgeBits.push('<span class="badge">你</span>');
  const bidText = seat.bid === null ? '未叫分' : `${seat.bid} 分`;
  const safeName = escapeHtml(seat.name);
  const chat = latestChatBySeat(seat.seat);
  node.innerHTML = `
    <div class="seat-name">
      <span>${title} · ${safeName}</span>
      <span class="badge">${seat.cardCount} 张</span>
    </div>
    <div class="seat-meta">
      <span class="badge score-badge">${seat.score} 分</span>
      <span class="badge">${bidText}</span>
      ${badgeBits.join('')}
    </div>
    ${chat ? `<div class="chat-bubble seat-chat">${escapeHtml(chat.text)}</div>` : ''}
    <div class="subtle">${direction}</div>
  `;
}

function renderBottomCards(cards) {
  bottomCards.innerHTML = '';
  if (!cards || cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'subtle';
    empty.textContent = '暂无';
    bottomCards.appendChild(empty);
    return;
  }
  for (const card of cards) {
    const node = document.createElement('div');
    if (card.hidden) {
      node.className = 'mini-card back';
      node.setAttribute('aria-label', '隐藏底牌');
    } else {
      node.className = `mini-card ${suitColor(card)}`;
      node.innerHTML = cardFaceHtml(card, true);
    }
    bottomCards.appendChild(node);
  }
}

function renderScoreBoard(room) {
  scoreBoard.innerHTML = '';
  const players = (room.players || []).filter((player) => player && !player.empty);
  for (const player of players) {
    const item = document.createElement('div');
    item.className = `score-item${player.isYou ? ' you' : ''}${player.isLandlord ? ' landlord' : ''}`;

    const name = document.createElement('span');
    name.className = 'score-name';
    name.textContent = player.isYou ? `${player.name}（你）` : player.name;

    const value = document.createElement('span');
    value.className = 'score-value';
    value.textContent = `${player.score} 分`;

    item.appendChild(name);
    item.appendChild(value);

    const delta = room.settlement?.deltas?.[player.seat];
    if (typeof delta === 'number' && delta !== 0) {
      const deltaNode = document.createElement('span');
      deltaNode.className = `score-delta ${delta > 0 ? 'plus' : 'minus'}`;
      deltaNode.textContent = formatDelta(delta);
      item.appendChild(deltaNode);
    }

    scoreBoard.appendChild(item);
  }
}

function renderMyChatBubble(room) {
  const chat = latestChatBySeat(room.viewerSeat);
  if (!chat) {
    myChatBubble.classList.add('hidden');
    myChatBubble.textContent = '';
    return;
  }
  myChatBubble.textContent = chat.text;
  myChatBubble.classList.remove('hidden');
}

function renderPlayedCards(room) {
  playedCards.innerHTML = '';
  const cards = displaySortedCards(room.currentCards || []);
  const playerName = room.lastPlaySeat === null || room.lastPlaySeat === undefined
    ? ''
    : playerNameBySeat(room.lastPlaySeat);
  playedByLabel.textContent = playerName && room.currentCombo
    ? `${playerName} 出牌`
    : '出牌';

  if (!cards.length) {
    const empty = document.createElement('div');
    empty.className = 'subtle';
    empty.textContent = '本轮未开牌';
    playedCards.appendChild(empty);
    return;
  }

  for (const card of cards) {
    const node = document.createElement('div');
    node.className = `mini-card played ${suitColor(card)}`;
    node.innerHTML = cardFaceHtml(card, true);
    playedCards.appendChild(node);
  }
}

function canQuickPlaySingle() {
  const room = state.room;
  return room
    && room.phase === 'playing'
    && room.viewerSeat >= 0
    && room.turnSeat === room.viewerSeat;
}

function handleHandCardClick(card) {
  const now = Date.now();
  const isDoubleClick = state.lastCardClick.id === card.id && now - state.lastCardClick.ts <= 420;
  if (isDoubleClick && canQuickPlaySingle()) {
    state.lastCardClick = { id: '', ts: 0 };
    sendAction('play', { cardIds: [card.id] });
    return;
  }

  state.lastCardClick = { id: card.id, ts: now };
  if (state.selectedIds.has(card.id)) {
    state.selectedIds.delete(card.id);
  } else {
    state.selectedIds.add(card.id);
  }
  render();
}

function renderHand(cards, animateDeal = false) {
  hand.innerHTML = '';
  const handIds = new Set(cards.map((card) => card.id));
  for (const id of [...state.selectedIds]) {
    if (!handIds.has(id)) state.selectedIds.delete(id);
  }
  if (state.lastCardClick.id && !handIds.has(state.lastCardClick.id)) {
    state.lastCardClick = { id: '', ts: 0 };
  }
  const selectedCount = state.selectedIds.size;
  handHint.textContent = selectedCount > 0 ? `已选择 ${selectedCount} 张` : '未选择牌';

  displaySortedCards(cards).forEach((card, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `card ${suitColor(card)}${state.selectedIds.has(card.id) ? ' selected' : ''}${animateDeal ? ' dealt-in' : ''}`;
    if (animateDeal) {
      btn.style.animationDelay = `${180 + Math.min(index, 20) * 28}ms`;
    }
    btn.dataset.id = card.id;
    btn.setAttribute('aria-pressed', state.selectedIds.has(card.id) ? 'true' : 'false');
    btn.innerHTML = cardFaceHtml(card);
    btn.addEventListener('click', () => handleHandCardClick(card));
    hand.appendChild(btn);
  });
}

function renderActions(room) {
  actionBar.innerHTML = '';
  const phase = room.phase;
  const mySeat = room.viewerSeat;
  const isMyTurn = mySeat !== -1 && room.turnSeat === mySeat;
  const isMyBidTurn = mySeat !== -1 && room.bidTurnSeat === mySeat;
  const hasSelection = state.selectedIds.size > 0;

  if (phase === 'waiting') {
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'primary-btn';
    startBtn.textContent = room.canStart ? '开始对局' : '等待 3 名在线玩家';
    startBtn.disabled = !room.canStart;
    startBtn.addEventListener('click', () => sendAction('start'));
    actionBar.appendChild(startBtn);
    return;
  }

  if (phase === 'bidding') {
    if (!isMyBidTurn) {
      const tip = document.createElement('div');
      tip.className = 'subtle';
      tip.textContent = `等待 ${currentSeatPlayerName(room.bidTurnSeat)} 叫分`;
      actionBar.appendChild(tip);
      return;
    }
    [0, 1, 2, 3].forEach((score) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = score === 3 ? 'primary-btn' : 'small-btn';
      btn.textContent = score === 0 ? '不叫' : `${score} 分`;
      btn.addEventListener('click', () => sendAction('bid', { score }));
      actionBar.appendChild(btn);
    });
    return;
  }

  if (phase === 'playing') {
    if (!isMyTurn) {
      const tip = document.createElement('div');
      tip.className = 'subtle';
      tip.textContent = `等待 ${currentSeatPlayerName(room.turnSeat)} 出牌`;
      actionBar.appendChild(tip);
      return;
    }

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'primary-btn';
    playBtn.textContent = '出牌';
    playBtn.disabled = !hasSelection;
    playBtn.addEventListener('click', () => sendAction('play', { cardIds: [...state.selectedIds] }));
    actionBar.appendChild(playBtn);

    const passBtn = document.createElement('button');
    passBtn.type = 'button';
    passBtn.className = 'small-btn';
    passBtn.textContent = '不要';
    passBtn.disabled = !room.currentCombo;
    passBtn.addEventListener('click', () => sendAction('pass'));
    actionBar.appendChild(passBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'small-btn';
    clearBtn.textContent = '清空';
    clearBtn.addEventListener('click', () => {
      state.selectedIds.clear();
      render();
    });
    actionBar.appendChild(clearBtn);
    return;
  }

  if (phase === 'ended') {
    const restartBtn = document.createElement('button');
    restartBtn.type = 'button';
    restartBtn.className = 'primary-btn';
    restartBtn.textContent = room.canRestart ? '再来一局' : '等待玩家重连';
    restartBtn.disabled = !room.canRestart;
    restartBtn.addEventListener('click', () => sendAction('restart'));
    actionBar.appendChild(restartBtn);
  }
}

function render() {
  const room = state.room;
  if (!room) {
    joinScreen.classList.remove('hidden');
    gameShell.classList.add('hidden');
    roomBadge.textContent = '未加入';
    copyLinkBtn.disabled = true;
    leaveBtn.classList.add('hidden');
    myChatBubble.classList.add('hidden');
    chatInput.disabled = true;
    clearChatTimer();
    clearBombAnimation();
      state.hasRenderedRoom = false;
    return;
  }

  const animateDeal = shouldStartDealAnimation(room);
  const animateBomb = shouldStartBombAnimation(room);
  joinScreen.classList.add('hidden');
  gameShell.classList.remove('hidden');
  copyLinkBtn.disabled = false;
  leaveBtn.classList.remove('hidden');
  chatInput.disabled = false;

  roomBadge.textContent = `房间 ${room.roomCode}`;
  phaseLabel.textContent = ({
    waiting: '等待开局',
    bidding: '叫分中',
    playing: '出牌中',
    ended: '已结束',
  }[room.phase] || room.phase);

  const me = room.viewerSeat >= 0 ? room.players[room.viewerSeat] : null;
  const currentTurn = room.phase === 'bidding' ? room.bidTurnSeat : room.turnSeat;
  turnLabel.textContent = currentTurn === null || currentTurn === undefined ? '-' : `${playerNameBySeat(currentTurn)}${currentTurn === room.viewerSeat ? '（你）' : ''}`;

  landlordLabel.textContent = room.landlordSeat === null || room.landlordSeat === undefined
    ? '-'
    : `${playerNameBySeat(room.landlordSeat)}${room.landlordSeat === room.viewerSeat ? '（你）' : ''}`;

  comboLabel.textContent = room.currentCombo
    ? `${room.currentCombo.label} · ${room.currentCombo.cardCount} 张`
    : '本轮未开牌';
  const baseScore = room.baseScore ?? 10;
  const multiplier = room.multiplier ?? 1;
  const unitScore = baseScore * multiplier;
  baseScoreLabel.textContent = `${baseScore}`;
  multiplierLabel.textContent = room.bombCount > 0
    ? `x${multiplier}（炸弹 ${room.bombCount}）`
    : `x${multiplier}`;
  if (room.settlement) {
    const delta = room.settlement.deltas?.[room.viewerSeat];
    settlementLabel.textContent = typeof delta === 'number'
      ? formatDelta(delta)
      : (room.settlement.landlordWon ? '地主赢' : '农民赢');
  } else {
    settlementLabel.textContent = `单份 ${unitScore}`;
  }

  const players = room.players || [];
  const leftSeat = players[(room.viewerSeat + 1) % 3];
  const rightSeat = players[(room.viewerSeat + 2) % 3];
  renderSeat(seatLeft, leftSeat, '左家', '下一手');
  renderSeat(seatRight, rightSeat, '右家', '上一手');

  renderScoreBoard(room);
  renderPlayedCards(room);
  renderMyChatBubble(room);
  renderBottomCards(room.bottomCards);
  renderHand(room.yourHand || [], animateDeal);
  renderActions(room);
  scheduleChatExpiry();
  if (animateDeal) {
    window.requestAnimationFrame(playDealAnimation);
  }
  if (animateBomb) {
    window.requestAnimationFrame(() => playBombAnimation(room.currentCombo.type));
  }
  state.hasRenderedRoom = true;

  if (me) {
    setStatus(`当前房间 ${room.roomCode}，你是 ${me.name}`);
  } else {
    setStatus(`当前房间 ${room.roomCode}`);
  }
  const share = escapeRoomUrl(room.roomCode);
  copyLinkBtn.dataset.share = share;
}

async function sendAction(action, extra = {}) {
  if (!state.roomCode || !state.playerId) return;
  setJoinTip(action === 'chat' ? '正在发送消息...' : '正在发送操作...');
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomCode: state.roomCode,
        playerId: state.playerId,
        action,
        ...extra,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || '操作失败');
    }
    if (state.selectedIds.size && action === 'play') {
      state.selectedIds.clear();
    }
    setJoinTip(action === 'chat' ? '消息已发送' : '操作成功');
    if (data.state) {
      state.room = data.state;
      render();
    }
  } catch (error) {
    setJoinTip(error.message || '操作失败');
  }
}

async function leaveRoom() {
  if (!state.roomCode || !state.playerId) {
    resetLocalRoom();
    return;
  }

  if (state.room && (state.room.phase === 'bidding' || state.room.phase === 'playing')) {
    const ok = window.confirm('退出会结束当前对局，确定退出房间？');
    if (!ok) return;
  }

  const roomCode = state.roomCode;
  const playerId = state.playerId;
  setJoinTip('正在退出房间...');
  leaveBtn.disabled = true;
  try {
    const res = await fetch('/api/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerId }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || '退出失败');
    }
    resetLocalRoom('已退出房间');
  } catch (error) {
    resetLocalRoom(`本机已退出；服务器返回：${error.message || '连接失败'}`);
  } finally {
    leaveBtn.disabled = false;
  }
}

function openStream() {
  clearSource();
  const url = `/api/events?roomCode=${encodeURIComponent(state.roomCode)}&playerId=${encodeURIComponent(state.playerId)}`;
  const source = new EventSource(url);
  state.source = source;

  source.addEventListener('state', (event) => {
    state.room = JSON.parse(event.data);
    state.selectedIds = new Set([...state.selectedIds].filter((id) => state.room.yourHand.some((card) => card.id === id)));
    setJoinTip('已连接到房间');
    render();
  });

  source.addEventListener('left', () => {
    resetLocalRoom('已退出房间');
  });

  source.addEventListener('escapeClose', closeBrowserPage);

  source.onerror = () => {
    setStatus('连接有波动，正在重连...');
  };
}

async function joinRoom() {
  const name = nameInput.value.trim() || '玩家';
  const roomCode = roomInput.value.trim();
  const playerId = state.playerId || localStorage.getItem('ddz_playerId') || '';
  setJoinTip('正在加入房间...');
  joinBtn.disabled = true;
  try {
    const res = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        roomCode,
        playerId,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || '加入失败');
    }

    state.roomCode = data.roomCode;
    state.playerId = data.playerId;
    state.name = name;
    state.room = data.state;

    localStorage.setItem('ddz_room', data.roomCode);
    localStorage.setItem('ddz_playerId', data.playerId);
    localStorage.setItem('ddz_name', name);

    roomInput.value = data.roomCode;
    setJoinTip(`已进入房间 ${data.roomCode}，把链接发给另外两台设备`);
    setStatus(`当前房间 ${data.roomCode}`);
    openStream();
    render();
  } catch (error) {
    setJoinTip(error.message || '加入失败');
  } finally {
    joinBtn.disabled = false;
  }
}

copyLinkBtn.addEventListener('click', async () => {
  const share = copyLinkBtn.dataset.share || escapeRoomUrl(roomInput.value.trim() || state.roomCode || '');
  if (!share || share.endsWith('room=')) return;
  try {
    await navigator.clipboard.writeText(share);
    setJoinTip('邀请链接已复制');
  } catch (error) {
    window.prompt('复制这个链接给其它玩家：', share);
  }
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !state.roomCode || !state.playerId) return;
  chatInput.value = '';
  sendAction('chat', { text });
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !state.room || state.closingPage) return;
  event.preventDefault();
  requestRoomEscapeClose();
}, true);

leaveBtn.addEventListener('click', leaveRoom);
joinBtn.addEventListener('click', joinRoom);
nameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') joinRoom();
});
roomInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') joinRoom();
});

loadSaved();
render();

if (state.roomCode && state.playerId && state.name) {
  joinRoom();
}
