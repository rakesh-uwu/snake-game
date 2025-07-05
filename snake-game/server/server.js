const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());


const GRID_WIDTH = 40;
const GRID_HEIGHT = 30;
const GAME_SPEED = 150;

const rooms = new Map();
const players = new Map();


function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createRoom(hostId, hostName) {
  const roomCode = generateRoomCode();
  const room = {
    code: roomCode,
    players: new Map(),
    gameActive: false,
    gamePaused: false,
    gameLoop: null,
    food: [],
    hostId: hostId,
    lastUpdateTime: Date.now()
  };
  

  const hostPlayer = {
    id: hostId,
    name: hostName,
    snake: [],
    direction: { x: 1, y: 0 },
    nextDirection: { x: 1, y: 0 },
    alive: true,
    score: 0,
    isHost: true
  };
  
  room.players.set(hostId, hostPlayer);
  rooms.set(roomCode, room);
  players.set(hostId, roomCode);
  
  return room;
}

function joinRoom(roomCode, playerId, playerName) {
  const room = rooms.get(roomCode);
  if (!room) {
    throw new Error('Room not found');
  }
  
  if (room.players.size >= 4) {
    throw new Error('Room is full');
  }
  
  if (room.gameActive) {
    throw new Error('Game is already in progress');
  }
  
  const player = {
    id: playerId,
    name: playerName,
    snake: [],
    direction: { x: 1, y: 0 },
    nextDirection: { x: 1, y: 0 },
    alive: true,
    score: 0,
    isHost: false
  };
  
  room.players.set(playerId, player);
  players.set(playerId, roomCode);
  
  return room;
}

function initializeGame(room) {
  const playerArray = Array.from(room.players.values());
  const startPositions = [
    { x: 5, y: 10 },
    { x: 24, y: 10 },
    { x: 5, y: 15 },
    { x: 24, y: 15 }
  ];
  

  playerArray.forEach((player, index) => {
    const pos = startPositions[index % startPositions.length];
    player.snake = [
      pos,
      { x: pos.x - 1, y: pos.y },
      { x: pos.x - 2, y: pos.y }
    ];
    player.direction = { x: 1, y: 0 };
    player.nextDirection = { x: 1, y: 0 };
    player.alive = true;
    player.score = 0;
  });
  
  generateFood(room);
  room.gameActive = true;
}

function generateFood(room) {
  const food = [];
  const maxFood = Math.min(3, room.players.size + 1);
  
  for (let i = 0; i < maxFood; i++) {
    let pos;
    let attempts = 0;
    do {
      pos = {
        x: Math.floor(Math.random() * GRID_WIDTH),
        y: Math.floor(Math.random() * GRID_HEIGHT)
      };
      attempts++;
    } while (isPositionOccupied(room, pos) && attempts < 50);
    
    if (attempts < 50) {
      food.push(pos);
    }
  }
  
  room.food = food;
}

function isPositionOccupied(room, pos) {
  for (const player of room.players.values()) {
    if (player.snake.some(segment => segment.x === pos.x && segment.y === pos.y)) {
      return true;
    }
  }
  
  return room.food.some(f => f.x === pos.x && f.y === pos.y);
}

function updateGame(room) {
  if (!room.gameActive || room.gamePaused) return;
  
  const alivePlayers = [];
  
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    

    player.direction = { ...player.nextDirection };
    
    const head = { ...player.snake[0] };
    head.x += player.direction.x;
    head.y += player.direction.y;
    
    if (head.x < 0 || head.x >= GRID_WIDTH || head.y < 0 || head.y >= GRID_HEIGHT) {
      player.alive = false;
      continue;
    }
    if (player.snake.some(segment => segment.x === head.x && segment.y === head.y)) {
      player.alive = false;
      continue;
    }
    
    let collided = false;
    for (const otherPlayer of room.players.values()) {
      if (otherPlayer.id !== player.id && otherPlayer.alive) {
        if (otherPlayer.snake.some(segment => segment.x === head.x && segment.y === head.y)) {
          player.alive = false;
          collided = true;
          break;
        }
      }
    }
    
    if (collided) continue;
    
    const foodIndex = room.food.findIndex(food => food.x === head.x && food.y === head.y);
    let ateFood = false;
    
    if (foodIndex !== -1) {
      room.food.splice(foodIndex, 1);
      player.score += 10;
      ateFood = true;
      
      let newFood;
      let attempts = 0;
      do {
        newFood = {
          x: Math.floor(Math.random() * GRID_WIDTH),
          y: Math.floor(Math.random() * GRID_HEIGHT)
        };
        attempts++;
      } while (isPositionOccupied(room, newFood) && attempts < 50);
      
      if (attempts < 50) {
        room.food.push(newFood);
      }
    }
    
    player.snake.unshift(head);
    if (!ateFood) {
      player.snake.pop();
    }
    
    alivePlayers.push(player);
  }
  
  const totalPlayers = room.players.size;
  if ((totalPlayers > 1 && alivePlayers.length <= 1) || 
      (totalPlayers === 1 && alivePlayers.length === 0)) {
    
    room.gameActive = false;
    if (room.gameLoop) {
      clearInterval(room.gameLoop);
      room.gameLoop = null;
    }
    
    const winner = alivePlayers.length === 1 ? alivePlayers[0] : null;
    
    io.to(room.code).emit('gameOver', {
      gameOver: true,
      winner: winner,
      players: Array.from(room.players.values()),
      food: room.food
    });
    
    setTimeout(() => {
      if (room.players.size > 0) {
        initializeGame(room);
        startGameLoop(room);
      }
    }, 3000);
    
    return;
  }
  
  io.to(room.code).emit('gameUpdate', {
    players: Array.from(room.players.values()),
    food: room.food,
    gameOver: false
  });
}

function startGameLoop(room) {
  if (room.gameLoop) {
    clearInterval(room.gameLoop);
  }
  
  room.gameLoop = setInterval(() => {
    updateGame(room);
  }, GAME_SPEED);
}

function cleanupRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (room) {
    if (room.gameLoop) {
      clearInterval(room.gameLoop);
    }
    rooms.delete(roomCode);
  }
}

function handlePlayerDisconnect(socketId) {
  const roomCode = players.get(socketId);
  if (roomCode) {
    const room = rooms.get(roomCode);
    if (room) {
      const player = room.players.get(socketId);
      const playerName = player ? player.name : 'Unknown';
      
      room.players.delete(socketId);
      players.delete(socketId);
      
      if (room.players.size === 0) {
        cleanupRoom(roomCode);
        console.log(`Room ${roomCode} - empty`);
      } else {
        if (room.hostId === socketId) {
          const newHost = room.players.values().next().value;
          if (newHost) {
            room.hostId = newHost.id;
            newHost.isHost = true;
          }
        }
        
        io.to(roomCode).emit('playerLeft', {
          players: Array.from(room.players.values()),
          leftPlayerName: playerName
        });
        if (room.gameActive && room.players.size < 1) {
          room.gameActive = false;
          if (room.gameLoop) {
            clearInterval(room.gameLoop);
            room.gameLoop = null;
          }
          
          io.to(roomCode).emit('gameOver', {
            gameOver: true,
            winner: null,
            players: Array.from(room.players.values()),
            food: room.food,
            reason: 'Not enough players'
          });
        }
      }
      
      console.log(`${playerName} left room ${roomCode}`);
    }
  }
}

io.on('connection', (socket) => {
  console.log('Player connected');
  
  socket.on('createRoom', (data) => {
    try {
      const room = createRoom(socket.id, data.playerName);
      socket.join(room.code);
      
      socket.emit('roomCreated', {
        roomCode: room.code,
        players: Array.from(room.players.values())
      });
      
      
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });
  
  socket.on('joinRoom', (data) => {
    try {
      const room = joinRoom(data.roomCode, socket.id, data.playerName);
      socket.join(data.roomCode);
      
      const playerData = Array.from(room.players.values());
      const isHost = room.hostId === socket.id;
      
      socket.emit('roomJoined', {
        roomCode: data.roomCode,
        players: playerData,
        isHost: isHost
      });
      
      
      socket.to(data.roomCode).emit('playerJoined', {
        players: playerData
      });
      
      
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });
  
  socket.on('startGame', () => {
    const roomCode = players.get(socket.id);
    const room = rooms.get(roomCode);
    
    if (room && room.hostId === socket.id && !room.gameActive) {
      initializeGame(room);
      startGameLoop(room);
      
      io.to(roomCode).emit('gameStarted', {
        players: Array.from(room.players.values()),
        food: room.food,
        gameOver: false
      });
      
      console.log(`Game started in room ${roomCode}`);
    }
  });
  
  socket.on('changeDirection', (direction) => {
    const roomCode = players.get(socket.id);
    const room = rooms.get(roomCode);
    
    if (room && room.gameActive) {
      const player = room.players.get(socket.id);
      if (player && player.alive) {
        const directionMap = {
          'up': { x: 0, y: -1 },
          'down': { x: 0, y: 1 },
          'left': { x: -1, y: 0 },
          'right': { x: 1, y: 0 }
        };
        
        const newDir = directionMap[direction];
        if (newDir) {
          if (player.direction.x !== -newDir.x || player.direction.y !== -newDir.y) {
            player.nextDirection = newDir;
          }
        }
      }
    }
  });
  
  socket.on('leaveRoom', () => {
    handlePlayerDisconnect(socket.id);
  });
  
  socket.on('restartGame', () => {
    const roomCode = players.get(socket.id);
    const room = rooms.get(roomCode);
    
    if (room && room.hostId === socket.id && !room.gameActive) {
      initializeGame(room);
      startGameLoop(room);
      
      io.to(roomCode).emit('gameStarted', {
        players: Array.from(room.players.values()),
        food: room.food,
        gameOver: false
      });
      
    }
  });
  
  socket.on('getRoomInfo', () => {
    const roomCode = players.get(socket.id);
    const room = rooms.get(roomCode);
    
    if (room) {
      socket.emit('roomInfo', {
        roomCode: room.code,
        players: Array.from(room.players.values()),
        gameActive: room.gameActive,
        isHost: room.hostId === socket.id
      });
    }
  });
  
  socket.on('pauseGame', () => {
    const roomCode = players.get(socket.id);
    const room = rooms.get(roomCode);
    
    if (room && room.hostId === socket.id && room.gameActive && !room.gamePaused) {
      room.gamePaused = true;
      
      io.to(roomCode).emit('gamePaused', {
        players: Array.from(room.players.values()),
        food: room.food
      });
      
      console.log(`Game paused in room ${roomCode}`);
    }
  });
  
  socket.on('resumeGame', () => {
    const roomCode = players.get(socket.id);
    const room = rooms.get(roomCode);
    
    if (room && room.hostId === socket.id && room.gameActive && room.gamePaused) {
      room.gamePaused = false;
      
      io.to(roomCode).emit('gameResumed', {
        players: Array.from(room.players.values()),
        food: room.food
      });
      
      console.log(`Game resumed in room ${roomCode}`);
    }
  });
  
  socket.on('stopGame', () => {
    const roomCode = players.get(socket.id);
    const room = rooms.get(roomCode);
    
    if (room && room.hostId === socket.id && room.gameActive) {
      room.gameActive = false;
      room.gamePaused = false;
      
      if (room.gameLoop) {
        clearInterval(room.gameLoop);
        room.gameLoop = null;
      }
      
      io.to(roomCode).emit('gameStopped', {
        players: Array.from(room.players.values()),
        food: room.food
      });
      
      console.log(`Game stopped in room ${roomCode}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:');
    handlePlayerDisconnect(socket.id);
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    rooms: rooms.size, 
    players: players.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

app.get('/stats', (req, res) => {
  const roomStats = Array.from(rooms.values()).map(room => ({
    code: room.code,
    playerCount: room.players.size,
    gameActive: room.gameActive,
    hostId: room.hostId
  }));
  
  res.json({
    totalRooms: rooms.size,
    totalPlayers: players.size,
    rooms: roomStats
  });
});

setInterval(() => {
  const now = Date.now();
  const roomsToCleanup = [];
  
  for (const [roomCode, room] of rooms.entries()) {
    if (now - room.lastUpdateTime > 30 * 60 * 1000 && room.players.size === 0) {
      roomsToCleanup.push(roomCode);
    }
  }
  
  roomsToCleanup.forEach(roomCode => {
    cleanupRoom(roomCode);
    console.log(`Cleaned up inactive room: ${roomCode}`);
  });
}, 10 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Snake game server running on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  console.log(`Stats available at http://localhost:${PORT}/stats`);
});