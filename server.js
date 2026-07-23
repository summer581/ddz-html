const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

const rooms = new Map();
const INITIAL_SCORE = 100;
const BASE_SCORE = 10;
const CHAT_VISIBLE_MS = 10000;
const MAX_CHAT_MESSAGES = 24;
const MAX_CHAT_LENGTH = 80;
const BOT_NAMES = ['模拟用户 A', '模拟用户 B'];
const BOT_ACTION_DELAY_MS = 650;

const SUITS = [
  { key: 'S', symbol: '♠', order: 0 },
  { key: 'H', symbol: '♥', order: 1 },
  { key: 'C', symbol: '♣', order: 2 },
  { key: 'D', symbol: '♦', order: 3 },
];

const SUIT_BY_KEY = new Map(SUITS.map((s) => [s.key, s]));
const SUIT_ORDER = new Map(SUITS.map((s) => [s.key, s.order]));

function rankLabel(rank) {
  const labels = {
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
  };
  return labels[rank] || String(rank);
}

function rankText(rank) {
  const text = {
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
  };
  return text[rank] || String(rank);
}

function createDeck() {
  const deck = [];
  let index = 0;
  for (let rank = 3; rank <= 15; rank += 1) {
    for (const suit of SUITS) {
      deck.push({
        id: `${rank}-${suit.key}-${index += 1}`,
        rank,
        suit: suit.key,
        label: rankLabel(rank),
        display: `${rankLabel(rank)}${suit.symbol}`,
      });
    }
  }
  deck.push({
    id: `16-SJ-${index += 1}`,
    rank: 16,
    suit: 'SJ',
    label: '小王',
    display: '小王',
  });
  deck.push({
    id: `17-BJ-${index += 1}`,
    rank: 17,
    suit: 'BJ',
    label: '大王',
    display: '大王',
  });
  return deck;
}

function shuffle(cards) {
  const arr = cards.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sortCards(cards) {
  return cards.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return (SUIT_ORDER.get(a.suit) ?? 99) - (SUIT_ORDER.get(b.suit) ?? 99);
  });
}

function cloneCard(card) {
  return {
    id: card.id,
    rank: card.rank,
    suit: card.suit,
    label: card.label,
    display: card.display,
  };
}

function formatCard(card) {
  return card.display;
}

function formatCards(cards) {
  return cards.map(formatCard).join(' ');
}

function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return code;
}

function normalizeRoomCode(input) {
  const text = String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return text.slice(0, 8);
}

function normalizeName(input) {
  const text = String(input || '').trim().replace(/\s+/g, ' ');
  if (!text) return '玩家';
  return text.slice(0, 16);
}

function normalizeChatText(input) {
  const text = String(input || '').trim().replace(/\s+/g, ' ');
  return text.slice(0, MAX_CHAT_LENGTH);
}

function normalizePlayerId(input) {
  const text = String(input || '').trim();
  return text || crypto.randomUUID();
}

function createRoom(code) {
  return {
    code,
    phase: 'waiting',
    round: 0,
    seats: [null, null, null],
    players: new Map(),
    sse: new Map(),
    hands: [[], [], []],
    bottomCards: [],
    landlordSeat: null,
    turnSeat: null,
    bidTurnSeat: null,
    bids: [null, null, null],
    currentCombo: null,
    currentCards: [],
    lastPlaySeat: null,
    passCount: 0,
    winnerSeat: null,
    baseScore: BASE_SCORE,
    multiplier: 1,
    bombCount: 0,
    settlement: null,
    chatMessages: [],
    history: [],
    botTimer: null,
    createdAt: Date.now(),
  };
}

function getOrCreateRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, createRoom(code));
  }
  return rooms.get(code);
}

function seatOf(room, playerId) {
  const player = room.players.get(playerId);
  return player ? player.seat : -1;
}

function playerCount(room) {
  return room.seats.filter(Boolean).length;
}

function connectedCount(room) {
  let total = 0;
  for (const player of room.players.values()) {
    if (player.connected) total += 1;
  }
  return total;
}

function seatPlayerName(room, seat) {
  const playerId = room.seats[seat];
  if (!playerId) return '空位';
  const player = room.players.get(playerId);
  return player ? player.name : '空位';
}

function pushHistory(room, text) {
  room.history.push({
    ts: Date.now(),
    text,
  });
  if (room.history.length > 60) {
    room.history.splice(0, room.history.length - 60);
  }
}

function addSimulatedUsers(room) {
  let added = 0;
  let botIndex = [...room.players.values()].filter((player) => player.isBot).length;

  for (let seat = 0; seat < room.seats.length && playerCount(room) < 3; seat += 1) {
    if (room.seats[seat]) continue;
    const name = BOT_NAMES[botIndex] || `模拟用户 ${botIndex + 1}`;
    const id = `bot-${room.code}-${seat}`;
    room.seats[seat] = id;
    room.players.set(id, {
      id,
      name,
      seat,
      connected: true,
      isBot: true,
      score: INITIAL_SCORE,
      joinedAt: Date.now(),
    });
    pushHistory(room, `${name} 加入了房间`);
    added += 1;
    botIndex += 1;
  }

  return added;
}

function pruneChatMessages(room) {
  const now = Date.now();
  if (!Array.isArray(room.chatMessages)) room.chatMessages = [];
  room.chatMessages = room.chatMessages.filter((message) => message.expiresAt > now);
}

function pushChatMessage(room, player, text) {
  const now = Date.now();
  pruneChatMessages(room);
  room.chatMessages.push({
    id: crypto.randomUUID(),
    ts: now,
    expiresAt: now + CHAT_VISIBLE_MS,
    seat: player.seat,
    playerId: player.id,
    name: player.name,
    text,
  });
  if (room.chatMessages.length > MAX_CHAT_MESSAGES) {
    room.chatMessages.splice(0, room.chatMessages.length - MAX_CHAT_MESSAGES);
  }
}

function resetRoundScoring(room) {
  room.baseScore = BASE_SCORE;
  room.multiplier = 1;
  room.bombCount = 0;
  room.settlement = null;
}

function applySettlement(room, winnerSeat) {
  if (room.landlordSeat === null || room.landlordSeat === undefined) return null;
  const unitScore = room.baseScore * room.multiplier;
  const landlordWon = winnerSeat === room.landlordSeat;
  const deltas = [0, 0, 0];

  if (landlordWon) {
    deltas[room.landlordSeat] = unitScore * 2;
    for (let seat = 0; seat < 3; seat += 1) {
      if (seat !== room.landlordSeat) deltas[seat] = -unitScore;
    }
  } else {
    deltas[room.landlordSeat] = -unitScore * 2;
    for (let seat = 0; seat < 3; seat += 1) {
      if (seat !== room.landlordSeat) deltas[seat] = unitScore;
    }
  }

  for (let seat = 0; seat < 3; seat += 1) {
    const playerId = room.seats[seat];
    const player = playerId ? room.players.get(playerId) : null;
    if (player) {
      player.score = (Number.isFinite(player.score) ? player.score : INITIAL_SCORE) + deltas[seat];
    }
  }

  room.settlement = {
    winnerSeat,
    landlordWon,
    baseScore: room.baseScore,
    multiplier: room.multiplier,
    bombCount: room.bombCount,
    unitScore,
    deltas,
  };

  const summary = deltas
    .map((delta, seat) => `${seatPlayerName(room, seat)} ${delta >= 0 ? '+' : ''}${delta}`)
    .join('，');
  pushHistory(
    room,
    `本局结算：底分 ${room.baseScore}，倍率 x${room.multiplier}，${landlordWon ? '地主通吃' : '农民对半分'}，${summary}`,
  );
  return room.settlement;
}

function isConsecutiveRanks(ranks) {
  for (let i = 1; i < ranks.length; i += 1) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

function comboLabel(type) {
  const labels = {
    single: '单张',
    pair: '对子',
    triple: '三张',
    tripleSingle: '三带一',
    triplePair: '三带二',
    straight: '顺子',
    pairStraight: '连对',
    tripleStraight: '飞机',
    planeSingle: '飞机带单',
    planePair: '飞机带对',
    fourTwoSingles: '四带两单',
    fourTwoPairs: '四带两对',
    bomb: '炸弹',
    rocket: '王炸',
  };
  return labels[type] || type;
}

function publicCombo(combo) {
  if (!combo) return null;
  return {
    type: combo.type,
    label: combo.label,
    mainRank: combo.mainRank,
    mainRankText: rankText(combo.mainRank),
    cardCount: combo.cardCount,
    groupCount: combo.groupCount || null,
  };
}

function publicBottomCards(room) {
  if (room.phase === 'waiting' || !room.bottomCards.length) return [];
  if (room.landlordSeat !== null && room.landlordSeat !== undefined) {
    return room.bottomCards.map(cloneCard);
  }
  return room.bottomCards.map((_, index) => ({
    id: `bottom-${index}`,
    hidden: true,
  }));
}

function analyzeCombo(cards) {
  const sorted = sortCards(cards.slice());
  const len = sorted.length;
  if (len === 0) return null;

  const counts = new Map();
  for (const card of sorted) {
    counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  }
  const uniqueRanks = [...counts.keys()].sort((a, b) => a - b);
  const countValues = [...counts.values()].sort((a, b) => a - b);
  const ranksUnderAce = uniqueRanks.every((rank) => rank >= 3 && rank <= 14);

  const rankByCount = (count) => uniqueRanks.find((rank) => counts.get(rank) === count);

  if (len === 2 && counts.has(16) && counts.has(17)) {
    return {
      type: 'rocket',
      label: comboLabel('rocket'),
      mainRank: 17,
      cardCount: 2,
    };
  }

  if (len === 1) {
    return {
      type: 'single',
      label: comboLabel('single'),
      mainRank: sorted[0].rank,
      cardCount: 1,
    };
  }

  if (len === 2 && uniqueRanks.length === 1) {
    return {
      type: 'pair',
      label: comboLabel('pair'),
      mainRank: uniqueRanks[0],
      cardCount: 2,
    };
  }

  if (len === 3 && uniqueRanks.length === 1) {
    return {
      type: 'triple',
      label: comboLabel('triple'),
      mainRank: uniqueRanks[0],
      cardCount: 3,
    };
  }

  if (len === 4) {
    if (uniqueRanks.length === 1) {
      return {
        type: 'bomb',
        label: comboLabel('bomb'),
        mainRank: uniqueRanks[0],
        cardCount: 4,
      };
    }
    if (uniqueRanks.length === 2 && countValues[0] === 1 && countValues[1] === 3) {
      const mainRank = rankByCount(3);
      return {
        type: 'tripleSingle',
        label: comboLabel('tripleSingle'),
        mainRank,
        cardCount: 4,
      };
    }
    if (countValues[0] === 2 && countValues[1] === 2) {
      return null;
    }
  }

  if (len === 5) {
    if (countValues[0] === 2 && countValues[1] === 3) {
      const mainRank = rankByCount(3);
      return {
        type: 'triplePair',
        label: comboLabel('triplePair'),
        mainRank,
        cardCount: 5,
      };
    }
    if (uniqueRanks.length === 5 && ranksUnderAce && isConsecutiveRanks(uniqueRanks)) {
      return {
        type: 'straight',
        label: comboLabel('straight'),
        mainRank: uniqueRanks[0],
        cardCount: 5,
      };
    }
  }

  if (len >= 5 && uniqueRanks.length === len && ranksUnderAce && isConsecutiveRanks(uniqueRanks)) {
    return {
      type: 'straight',
      label: comboLabel('straight'),
      mainRank: uniqueRanks[0],
      cardCount: len,
    };
  }

  if (len >= 6 && len % 2 === 0 && uniqueRanks.length * 2 === len) {
    const allPairs = uniqueRanks.every((rank) => counts.get(rank) === 2);
    if (allPairs && ranksUnderAce && isConsecutiveRanks(uniqueRanks)) {
      return {
        type: 'pairStraight',
        label: comboLabel('pairStraight'),
        mainRank: uniqueRanks[0],
        cardCount: len,
        groupCount: len / 2,
      };
    }
  }

  if (len >= 6 && len % 3 === 0 && uniqueRanks.length * 3 === len) {
    const allTriples = uniqueRanks.every((rank) => counts.get(rank) === 3);
    if (allTriples && ranksUnderAce && isConsecutiveRanks(uniqueRanks)) {
      return {
        type: 'tripleStraight',
        label: comboLabel('tripleStraight'),
        mainRank: uniqueRanks[0],
        cardCount: len,
        groupCount: len / 3,
      };
    }
  }

  if (len >= 8 && len % 4 === 0) {
    const tripleRanks = uniqueRanks.filter((rank) => counts.get(rank) === 3);
    const singleRanks = uniqueRanks.filter((rank) => counts.get(rank) === 1);
    const k = tripleRanks.length;
    if (
      k >= 2
      && tripleRanks.length === singleRanks.length
      && counts.size === k * 2
      && tripleRanks.every((rank) => rank <= 14)
      && isConsecutiveRanks(tripleRanks)
    ) {
      return {
        type: 'planeSingle',
        label: comboLabel('planeSingle'),
        mainRank: tripleRanks[0],
        cardCount: len,
        groupCount: k,
      };
    }
  }

  if (len >= 10 && len % 5 === 0) {
    const tripleRanks = uniqueRanks.filter((rank) => counts.get(rank) === 3);
    const pairRanks = uniqueRanks.filter((rank) => counts.get(rank) === 2);
    const k = tripleRanks.length;
    if (
      k >= 2
      && tripleRanks.length === pairRanks.length
      && counts.size === k * 2
      && tripleRanks.every((rank) => rank <= 14)
      && isConsecutiveRanks(tripleRanks)
    ) {
      return {
        type: 'planePair',
        label: comboLabel('planePair'),
        mainRank: tripleRanks[0],
        cardCount: len,
        groupCount: k,
      };
    }
  }

  if (len === 6) {
    const fourRank = uniqueRanks.find((rank) => counts.get(rank) === 4);
    if (fourRank !== undefined && uniqueRanks.length === 3) {
      return {
        type: 'fourTwoSingles',
        label: comboLabel('fourTwoSingles'),
        mainRank: fourRank,
        cardCount: 6,
      };
    }
  }

  if (len === 8) {
    const fourRank = uniqueRanks.find((rank) => counts.get(rank) === 4);
    if (fourRank !== undefined && uniqueRanks.length === 3) {
      const pairCount = uniqueRanks.filter((rank) => counts.get(rank) === 2).length;
      if (pairCount === 2) {
        return {
          type: 'fourTwoPairs',
          label: comboLabel('fourTwoPairs'),
          mainRank: fourRank,
          cardCount: 8,
        };
      }
    }
  }

  return null;
}

function canBeat(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  if (candidate.type === 'rocket') return true;
  if (current.type === 'rocket') return false;
  if (candidate.type === 'bomb' && current.type !== 'bomb') return true;
  if (candidate.type !== current.type) return false;
  if (candidate.type === 'bomb' && current.type === 'bomb') {
    return candidate.mainRank > current.mainRank;
  }
  if (candidate.cardCount !== current.cardCount) return false;
  if ((candidate.groupCount || null) !== (current.groupCount || null)) return false;
  return candidate.mainRank > current.mainRank;
}

function makeRound(room) {
  const deck = shuffle(createDeck());
  room.phase = 'bidding';
  room.winnerSeat = null;
  room.landlordSeat = null;
  resetRoundScoring(room);
  room.currentCombo = null;
  room.currentCards = [];
  room.lastPlaySeat = null;
  room.passCount = 0;
  room.bids = [null, null, null];
  room.bottomCards = deck.slice(51);
  room.hands = [
    sortCards(deck.slice(0, 17)),
    sortCards(deck.slice(17, 34)),
    sortCards(deck.slice(34, 51)),
  ];
  room.round += 1;
  room.bidTurnSeat = crypto.randomInt(3);
  room.turnSeat = room.bidTurnSeat;
  pushHistory(room, `第 ${room.round} 局开始，${seatPlayerName(room, room.bidTurnSeat)} 先叫分`);
}

function resetToWaiting(room) {
  room.phase = 'waiting';
  room.hands = [[], [], []];
  room.bottomCards = [];
  room.landlordSeat = null;
  resetRoundScoring(room);
  room.turnSeat = null;
  room.bidTurnSeat = null;
  room.bids = [null, null, null];
  room.currentCombo = null;
  room.currentCards = [];
  room.lastPlaySeat = null;
  room.passCount = 0;
  room.winnerSeat = null;
}

function resolveBidding(room) {
  const bids = room.bids.map((bid) => (bid === null ? 0 : bid));
  const maxBid = Math.max(...bids);
  if (maxBid === 0) {
    pushHistory(room, '无人叫分，重新发牌');
    makeRound(room);
    return;
  }

  const landlordSeat = bids.findIndex((bid) => bid === maxBid);
  room.landlordSeat = landlordSeat;
  room.hands[landlordSeat].push(...room.bottomCards);
  sortCards(room.hands[landlordSeat]);
  room.phase = 'playing';
  room.turnSeat = landlordSeat;
  room.currentCombo = null;
  room.currentCards = [];
  room.lastPlaySeat = null;
  room.passCount = 0;
  pushHistory(
    room,
    `${seatPlayerName(room, landlordSeat)} 叫到 ${maxBid} 分，成为地主，拿到底牌`,
  );
}

function cardWeight(card) {
  return card.rank * 10 + (SUIT_ORDER.get(card.suit) ?? 9);
}

function lowestSingleAbove(cards, minRank = -Infinity) {
  return cards
    .filter((card) => card.rank > minRank)
    .slice()
    .sort((a, b) => cardWeight(a) - cardWeight(b))[0] || null;
}

function chooseBotCard(room, seat) {
  const hand = room.hands[seat] || [];
  if (!room.currentCombo) return lowestSingleAbove(hand);
  if (room.currentCombo.type !== 'single') return null;
  return lowestSingleAbove(hand, room.currentCombo.mainRank);
}

function applyBotBid(room, player) {
  const hasPositiveBid = room.bids.some((bid) => bid > 0);
  const score = hasPositiveBid ? 0 : 1;
  room.bids[player.seat] = score;
  pushHistory(room, `${player.name} 选择了 ${score === 0 ? '不叫' : `${score} 分`}`);
  room.bidTurnSeat = (player.seat + 1) % 3;

  if (room.bids.every((bid) => bid !== null)) {
    resolveBidding(room);
  }
}

function applyBotPlay(room, player, card) {
  const combo = analyzeCombo([card]);
  const hand = room.hands[player.seat];
  room.hands[player.seat] = hand.filter((item) => item.id !== card.id);
  room.currentCombo = combo;
  room.currentCards = [cloneCard(card)];
  room.lastPlaySeat = player.seat;
  room.passCount = 0;
  pushHistory(room, `${player.name} 出了 ${combo.label}：${formatCard(card)}`);

  if (room.hands[player.seat].length === 0) {
    room.phase = 'ended';
    room.winnerSeat = player.seat;
    pushHistory(room, `${player.name} 已经出完手牌，${player.name} 获胜`);
    applySettlement(room, player.seat);
  } else {
    room.turnSeat = (player.seat + 1) % 3;
  }
}

function applyBotPass(room, player) {
  room.passCount += 1;
  pushHistory(room, `${player.name} 选择不要`);
  if (room.passCount >= 2) {
    room.currentCombo = null;
    room.currentCards = [];
    room.passCount = 0;
    room.turnSeat = room.lastPlaySeat;
    pushHistory(room, '两家都不要，轮到上一个出牌的人重新出牌');
  } else {
    room.turnSeat = (player.seat + 1) % 3;
  }
}

function currentBotTurnPlayer(room) {
  const seat = room.phase === 'bidding' ? room.bidTurnSeat : room.turnSeat;
  if (seat === null || seat === undefined || seat < 0) return null;
  const playerId = room.seats[seat];
  const player = playerId ? room.players.get(playerId) : null;
  return player && player.isBot ? player : null;
}

function scheduleBotTurn(room) {
  if (room.botTimer || (room.phase !== 'bidding' && room.phase !== 'playing')) return;
  const player = currentBotTurnPlayer(room);
  if (!player) return;

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    const current = currentBotTurnPlayer(room);
    if (!current || current.id !== player.id) return;

    if (room.phase === 'bidding') {
      applyBotBid(room, current);
    } else if (room.phase === 'playing') {
      const card = chooseBotCard(room, current.seat);
      if (card) {
        applyBotPlay(room, current, card);
      } else if (room.currentCombo) {
        applyBotPass(room, current);
      }
    }

    broadcast(room);
    scheduleBotTurn(room);
  }, BOT_ACTION_DELAY_MS);
}

function buildState(room, viewerId) {
  const viewerSeat = seatOf(room, viewerId);
  const players = room.seats.map((playerId, seat) => {
    if (!playerId) {
      return {
        seat,
        empty: true,
      };
    }
    const player = room.players.get(playerId);
    return {
      seat,
      id: playerId,
      name: player ? player.name : '未知玩家',
      connected: player ? player.connected : false,
      cardCount: room.hands[seat]?.length || 0,
      bid: room.bids[seat],
      isLandlord: room.landlordSeat === seat,
      isYou: playerId === viewerId,
      isBot: Boolean(player && player.isBot),
      score: player && Number.isFinite(player.score) ? player.score : INITIAL_SCORE,
    };
  });
  pruneChatMessages(room);

  return {
    roomCode: room.code,
    phase: room.phase,
    round: room.round,
    viewerId,
    viewerSeat,
    canStart: (room.phase === 'waiting' || room.phase === 'ended')
      && playerCount(room) === 3
      && connectedCount(room) === 3,
    canRestart: room.phase === 'ended' && playerCount(room) === 3 && connectedCount(room) === 3,
    turnSeat: room.turnSeat,
    bidTurnSeat: room.bidTurnSeat,
    landlordSeat: room.landlordSeat,
    winnerSeat: room.winnerSeat,
    baseScore: room.baseScore,
    multiplier: room.multiplier,
    bombCount: room.bombCount,
    settlement: room.settlement,
    passCount: room.passCount,
    bids: room.bids.slice(),
    players,
    yourHand: viewerSeat >= 0 ? room.hands[viewerSeat].map(cloneCard) : [],
    bottomCards: publicBottomCards(room),
    currentCombo: publicCombo(room.currentCombo),
    currentCards: Array.isArray(room.currentCards) ? room.currentCards.map(cloneCard) : [],
    lastPlaySeat: room.lastPlaySeat,
    chatMessages: room.chatMessages.slice(),
    history: room.history.slice(-30),
  };
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(room) {
  for (const [playerId, res] of room.sse.entries()) {
    if (res.writableEnded) {
      room.sse.delete(playerId);
      continue;
    }
    try {
      sendEvent(res, 'state', buildState(room, playerId));
    } catch (error) {
      room.sse.delete(playerId);
    }
  }
}

function broadcastRoomEvent(room, event, data = {}) {
  for (const [playerId, res] of room.sse.entries()) {
    if (res.writableEnded) {
      room.sse.delete(playerId);
      continue;
    }
    try {
      sendEvent(res, event, data);
    } catch (error) {
      room.sse.delete(playerId);
    }
  }
}

function replyJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    };
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function jsonError(message, statusCode = 400) {
  return { ok: false, error: message, statusCode };
}

async function handleJoin(req, res) {
  try {
    const body = await readJson(req);
    let roomCode = normalizeRoomCode(body.roomCode);
    if (!roomCode) {
      roomCode = generateRoomCode();
    }
    const name = normalizeName(body.name);
    const playerId = normalizePlayerId(body.playerId);
    const room = getOrCreateRoom(roomCode);

    const existing = room.players.get(playerId);
    if (!existing) {
      if (room.phase !== 'waiting') {
        replyJson(res, 409, jsonError('对局已经开始，不能加入新玩家'));
        return;
      }

      let seat = room.seats.findIndex((id) => id === null);
      if (seat === -1) {
        seat = room.seats.findIndex((id) => {
          if (!id) return false;
          const player = room.players.get(id);
          return player && !player.connected;
        });
      }

      if (seat === -1) {
        replyJson(res, 409, jsonError('房间已满'));
        return;
      }

      const replacedId = room.seats[seat];
      if (replacedId) {
        room.players.delete(replacedId);
        room.sse.delete(replacedId);
      }
      room.seats[seat] = playerId;
      room.players.set(playerId, {
        id: playerId,
        name,
        seat,
        connected: true,
        score: INITIAL_SCORE,
        joinedAt: Date.now(),
      });
      pushHistory(room, `${name} 加入了房间`);
    } else {
      existing.name = name;
      existing.connected = true;
      if (!Number.isFinite(existing.score)) existing.score = INITIAL_SCORE;
      existing.joinedAt = existing.joinedAt || Date.now();
      pushHistory(room, `${name} 回来了`);
    }

    const state = buildState(room, playerId);
    replyJson(res, 200, {
      ok: true,
      roomCode,
      playerId,
      seat: seatOf(room, playerId),
      state,
    });
    broadcast(room);
  } catch (error) {
    replyJson(res, 400, jsonError(error.message || '加入失败'));
  }
}

async function handleLeave(req, res) {
  try {
    const body = await readJson(req);
    const info = ensureActionRoom(body);
    if (info.error) {
      replyJson(res, 200, { ok: true });
      return;
    }

    const { room, playerId } = info;
    const player = room.players.get(playerId);
    if (!player) {
      replyJson(res, 200, { ok: true });
      return;
    }

    const seat = player.seat;
    const wasWaiting = room.phase === 'waiting';
    const name = player.name;
    const stream = room.sse.get(playerId);

    if (!wasWaiting) {
      resetToWaiting(room);
      pushHistory(room, `${name} 退出房间，本局结束，房间回到等待`);
    } else {
      pushHistory(room, `${name} 退出了房间`);
    }

    room.seats[seat] = null;
    room.players.delete(playerId);
    room.sse.delete(playerId);

    replyJson(res, 200, { ok: true });

    if (stream && !stream.writableEnded) {
      try {
        sendEvent(stream, 'left', { ok: true });
        stream.end();
      } catch (error) {
        // ignore closed stream
      }
    }

    if (playerCount(room) === 0) {
      rooms.delete(room.code);
      return;
    }
    broadcast(room);
  } catch (error) {
    replyJson(res, 400, jsonError(error.message || '退出失败'));
  }
}

function ensureActionRoom(body) {
  const roomCode = normalizeRoomCode(body.roomCode);
  const playerId = normalizePlayerId(body.playerId);
  if (!roomCode) return { error: '缺少房间号' };
  const room = rooms.get(roomCode);
  if (!room) return { error: '房间不存在' };
  return { room, roomCode, playerId };
}

async function handleAction(req, res) {
  try {
    const body = await readJson(req);
    const action = String(body.action || '').trim();
    const info = ensureActionRoom(body);
    if (info.error) {
      replyJson(res, 400, jsonError(info.error));
      return;
    }
    const { room, playerId } = info;
    const player = room.players.get(playerId);
    if (!player) {
      replyJson(res, 403, jsonError('玩家未在房间内'));
      return;
    }
    const seat = player.seat;

    if (action === 'escapeClose') {
      replyJson(res, 200, { ok: true });
      broadcastRoomEvent(room, 'escapeClose', { ts: Date.now() });
      return;
    }

    if (action === 'chat') {
      const text = normalizeChatText(body.text);
      if (!text) {
        replyJson(res, 400, jsonError('聊天内容不能为空'));
        return;
      }
      pushChatMessage(room, player, text);
      replyJson(res, 200, { ok: true, state: buildState(room, playerId) });
      broadcast(room);
      return;
    }

    if (action === 'addBots') {
      if (room.phase !== 'waiting') {
        replyJson(res, 409, jsonError('只有等待开局时才能添加模拟用户'));
        return;
      }
      const added = addSimulatedUsers(room);
      if (!added) {
        replyJson(res, 409, jsonError('房间已经满了'));
        return;
      }
      replyJson(res, 200, { ok: true, added, state: buildState(room, playerId) });
      broadcast(room);
      return;
    }

    if (action === 'start') {
      if (!(room.phase === 'waiting' || room.phase === 'ended')) {
        replyJson(res, 409, jsonError('当前不能开始新局'));
        return;
      }
      if (playerCount(room) !== 3 || connectedCount(room) !== 3) {
        replyJson(res, 409, jsonError('需要 3 名在线玩家才能开始'));
        return;
      }
      makeRound(room);
      pushHistory(room, '叫分开始');
      replyJson(res, 200, { ok: true, state: buildState(room, playerId) });
      broadcast(room);
      scheduleBotTurn(room);
      return;
    }

    if (action === 'bid') {
      if (room.phase !== 'bidding') {
        replyJson(res, 409, jsonError('当前不是叫分阶段'));
        return;
      }
      if (room.bidTurnSeat !== seat) {
        replyJson(res, 409, jsonError('还没轮到你叫分'));
        return;
      }
      const score = Number(body.score);
      if (!Number.isInteger(score) || score < 0 || score > 3) {
        replyJson(res, 400, jsonError('叫分必须是 0 到 3'));
        return;
      }
      if (room.bids[seat] !== null) {
        replyJson(res, 409, jsonError('你已经叫过分了'));
        return;
      }
      room.bids[seat] = score;
      pushHistory(room, `${player.name} 选择了 ${score === 0 ? '不叫' : `${score} 分`}`);
      room.bidTurnSeat = (seat + 1) % 3;

      if (room.bids.every((bid) => bid !== null)) {
        resolveBidding(room);
      }

      replyJson(res, 200, { ok: true, state: buildState(room, playerId) });
      broadcast(room);
      scheduleBotTurn(room);
      return;
    }

    if (action === 'play') {
      if (room.phase !== 'playing') {
        replyJson(res, 409, jsonError('当前不是出牌阶段'));
        return;
      }
      if (room.turnSeat !== seat) {
        replyJson(res, 409, jsonError('还没轮到你出牌'));
        return;
      }
      const ids = Array.isArray(body.cardIds) ? body.cardIds.map(String) : [];
      if (!ids.length) {
        replyJson(res, 400, jsonError('请选择要出的牌'));
        return;
      }
      const uniqueIds = new Set(ids);
      if (uniqueIds.size !== ids.length) {
        replyJson(res, 400, jsonError('不能重复选择同一张牌'));
        return;
      }
      const hand = room.hands[seat];
      const handMap = new Map(hand.map((card) => [card.id, card]));
      const cards = [];
      for (const id of ids) {
        const card = handMap.get(id);
        if (!card) {
          replyJson(res, 400, jsonError('选牌不在你的手牌中'));
          return;
        }
        cards.push(card);
      }
      const combo = analyzeCombo(cards);
      if (!combo) {
        replyJson(res, 400, jsonError('这组牌型不合法'));
        return;
      }
      if (!canBeat(combo, room.currentCombo)) {
        replyJson(res, 400, jsonError('这手牌压不过上家'));
        return;
      }

      const chosen = new Set(ids);
      room.hands[seat] = hand.filter((card) => !chosen.has(card.id));
      room.currentCombo = combo;
      room.currentCards = cards.map(cloneCard);
      room.lastPlaySeat = seat;
      room.passCount = 0;
      pushHistory(room, `${player.name} 出了 ${combo.label}：${formatCards(cards)}`);
      if (combo.type === 'bomb' || combo.type === 'rocket') {
        room.bombCount += 1;
        room.multiplier *= 2;
        pushHistory(room, `${combo.label} 翻倍，当前倍率 x${room.multiplier}`);
      }

      if (room.hands[seat].length === 0) {
        room.phase = 'ended';
        room.winnerSeat = seat;
        pushHistory(room, `${player.name} 已经出完手牌，${player.name} 获胜`);
        applySettlement(room, seat);
      } else {
        room.turnSeat = (seat + 1) % 3;
      }

      replyJson(res, 200, { ok: true, state: buildState(room, playerId) });
      broadcast(room);
      scheduleBotTurn(room);
      return;
    }

    if (action === 'pass') {
      if (room.phase !== 'playing') {
        replyJson(res, 409, jsonError('当前不是出牌阶段'));
        return;
      }
      if (room.turnSeat !== seat) {
        replyJson(res, 409, jsonError('还没轮到你不要'));
        return;
      }
      if (!room.currentCombo) {
        replyJson(res, 409, jsonError('这一轮必须先出牌，不能直接不要'));
        return;
      }
      room.passCount += 1;
      pushHistory(room, `${player.name} 选择不要`);
      if (room.passCount >= 2) {
        room.currentCombo = null;
        room.currentCards = [];
        room.passCount = 0;
        room.turnSeat = room.lastPlaySeat;
        pushHistory(room, '两家都不要，轮到上一个出牌的人重新出牌');
      } else {
        room.turnSeat = (seat + 1) % 3;
      }
      replyJson(res, 200, { ok: true, state: buildState(room, playerId) });
      broadcast(room);
      scheduleBotTurn(room);
      return;
    }

    if (action === 'restart') {
      if (!(room.phase === 'ended' || room.phase === 'waiting')) {
        replyJson(res, 409, jsonError('当前不能重新开始'));
        return;
      }
      if (playerCount(room) !== 3 || connectedCount(room) !== 3) {
        replyJson(res, 409, jsonError('需要 3 名在线玩家才能重新开始'));
        return;
      }
      makeRound(room);
      pushHistory(room, '准备新一局叫分');
      replyJson(res, 200, { ok: true, state: buildState(room, playerId) });
      broadcast(room);
      scheduleBotTurn(room);
      return;
    }

    replyJson(res, 400, jsonError('未知操作'));
  } catch (error) {
    replyJson(res, 400, jsonError(error.message || '操作失败'));
  }
}

function handleEvents(req, res, query) {
  const roomCode = normalizeRoomCode(query.roomCode);
  const playerId = normalizePlayerId(query.playerId);
  const room = rooms.get(roomCode);
  if (!room || !room.players.has(playerId)) {
    replyJson(res, 404, jsonError('房间或玩家不存在'));
    return;
  }

  const prev = room.sse.get(playerId);
  if (prev && prev !== res) {
    try {
      prev.end();
    } catch (error) {
      // ignore
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  room.sse.set(playerId, res);
  const player = room.players.get(playerId);
  if (player) {
    player.connected = true;
  }
  sendEvent(res, 'state', buildState(room, playerId));

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': ping\n\n');
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    if (room.sse.get(playerId) === res) {
      room.sse.delete(playerId);
    }
    const current = room.players.get(playerId);
    if (current) {
      current.connected = false;
      broadcast(room);
    }
  });
}

function localAddresses(port) {
  const results = [`http://localhost:${port}`];
  const nets = os.networkInterfaces();
  for (const net of Object.values(nets)) {
    for (const addr of net || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        results.push(`http://${addr.address}:${port}`);
      }
    }
  }
  return [...new Set(results)];
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname;

  if (req.method === 'GET' && pathname === '/') {
    serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    return;
  }

  if (req.method === 'GET' && pathname === '/app.js') {
    serveFile(res, path.join(PUBLIC_DIR, 'app.js'));
    return;
  }

  if (req.method === 'GET' && pathname === '/style.css') {
    serveFile(res, path.join(PUBLIC_DIR, 'style.css'));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/join') {
    handleJoin(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/leave') {
    handleLeave(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/action') {
    handleAction(req, res);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    handleEvents(req, res, Object.fromEntries(parsed.searchParams.entries()));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`斗地主局域网服务已启动:`);
    for (const url of localAddresses(PORT)) {
      console.log(`  ${url}`);
    }
  });
}

module.exports = {
  analyzeCombo,
  canBeat,
  createDeck,
  sortCards,
};
