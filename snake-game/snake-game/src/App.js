import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import './App.css';

const GRID_SIZE = 20;
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const SERVER_URL = 'https://server-snake-game.onrender.com';

function App() {
  const [socket, setSocket] = useState(null);
  const [gameState, setGameState] = useState('loading'); 
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [currentRoom, setCurrentRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [gameData, setGameData] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [serverStatus, setServerStatus] = useState('waking');
  const canvasRef = useRef(null);
  const pingTimerRef = useRef(null);

  const pingServer = useCallback(async () => {
    try {
      const response = await fetch(`${SERVER_URL}/ping`);
      if (response.ok) {
        setServerStatus('ready');
        setGameState('lobby');
        clearInterval(pingTimerRef.current);
      }
    } catch (error) {
      console.log('Server connection error:', error);
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        setServerStatus('error');
        setGameState('lobby');
      }
    }
  }, []);

  useEffect(() => {
    pingServer();
    pingTimerRef.current = setInterval(pingServer, 3000);
    const fallbackTimeout = setTimeout(() => {
      if (gameState === 'loading') {
        console.log('Server connection timeout, proceeding to lobby');
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
        }
        setServerStatus('error');
        setGameState('lobby');
      }
    }, 10000);
    return () => {
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
      }
      clearTimeout(fallbackTimeout);
    };
  }, [pingServer, gameState]);

  const connectToSocket = useCallback(() => {
    console.log('Attempting to connect to socket server:', SERVER_URL);
    const newSocket = io(SERVER_URL, {
      reconnectionAttempts: 3,
      timeout: 10000,
      reconnection: true,
      reconnectionDelay: 1000
    });
    
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Socket connected successfully');
      setGameState('lobby');
      setServerStatus('ready');
    });

    newSocket.on('connect_error', (error) => {
      console.log('Socket connection error:', error.message);
      if (gameState === 'loading') {
        setGameState('lobby');
        setServerStatus('error');
      }
    });
    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });

    newSocket.on('roomCreated', (data) => { 
      setCurrentRoom(data.roomCode);
      setIsHost(true);
      setGameState('waiting');
    });
    newSocket.on('roomJoined', (data) => { 
      setCurrentRoom(data.roomCode);
      setPlayers(data.players);
      setIsHost(data.isHost);
      setGameState('waiting');
    });

    newSocket.on('playerJoined', (data) => { 
      setPlayers(data.players);
    });
    newSocket.on('gameStarted', (data) => { 
      setGameData(data);
      setGameState('playing');
    });
    newSocket.on('gameUpdate', (data) => { 
      setGameData(data);
    });
    newSocket.on('gameOver', (data) => { 
      setGameData(data);
      setGameState('gameOver');
    });
    newSocket.on('gamePaused', (data) => { 
      setGameData(data);
      setGameState('paused');
    });
    newSocket.on('gameResumed', (data) => { 
      setGameData(data);
      setGameState('playing');
    });

    newSocket.on('gameStopped', (data) => { 
      setGameData(data);
      setGameState('waiting');
    });

    newSocket.on('error', (error) => { 
      alert(error.message);
    });
    
    return () => newSocket.close();
  }, [gameState]);

  useEffect(() => {
    if (serverStatus === 'ready' || serverStatus === 'error') {
      connectToSocket();
    }
  }, [serverStatus, connectToSocket]);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (gameState !== 'playing' || !socket) return;

      const keyMap = {
        'w': 'up',
        'W': 'up',
        'ArrowUp': 'up',
        's': 'down',
        'S': 'down',
        'ArrowDown': 'down',
        'a': 'left',
        'A': 'left',
        'ArrowLeft': 'left',
        'd': 'right',
        'D': 'right',
        'ArrowRight': 'right'
      };

      if (keyMap[e.key]) {
        socket.emit('changeDirection', keyMap[e.key]);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [gameState, socket]);

  const renderGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !gameData) return;

    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.strokeStyle = '#16213e';
    ctx.lineWidth = 1;
    for (let x = 0; x <= CANVAS_WIDTH; x += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_HEIGHT; y += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }
    gameData.food.forEach(food => {
      ctx.fillStyle = '#ffd93d';
      ctx.fillRect(
        food.x * GRID_SIZE + 2,
        food.y * GRID_SIZE + 2,
        GRID_SIZE - 4,
        GRID_SIZE - 4
      );
    });
    gameData.players.forEach((player, index) => {
      if (!player.snake || player.snake.length === 0) return;

      const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd'];
      ctx.fillStyle = player.alive ? colors[index % colors.length] : '#666';

      player.snake.forEach((segment, segIndex) => {
        ctx.fillRect(
          segment.x * GRID_SIZE,
          segment.y * GRID_SIZE,
          GRID_SIZE - 2,
          GRID_SIZE - 2
        );

      
        if (segIndex === 0 && player.alive) {
          ctx.fillStyle = 'white';
          ctx.fillRect(segment.x * GRID_SIZE + 4, segment.y * GRID_SIZE + 4, 4, 4);
          ctx.fillRect(segment.x * GRID_SIZE + 12, segment.y * GRID_SIZE + 4, 4, 4);
          ctx.fillStyle = colors[index % colors.length];
        }
      });
    });

    if (gameData.gameOver) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.strokeStyle = '#32CD32'; 
      ctx.lineWidth = 4;
      ctx.strokeRect(50, CANVAS_HEIGHT/2 - 80, CANVAS_WIDTH - 100, 160);
      
      ctx.shadowColor = '#32CD32';
      ctx.shadowBlur = 15;
      
      ctx.fillStyle = '#32CD32'; 
      ctx.font = "28px 'Press Start 2P', monospace";
      ctx.textAlign = 'center';
      
      if (gameData.winner) {
        ctx.fillText(`GAME COMPLETE`, CANVAS_WIDTH/2, CANVAS_HEIGHT/2 - 30);
        ctx.font = "20px 'Press Start 2P', monospace";
        ctx.fillText(`${gameData.winner.name} WINS!`, CANVAS_WIDTH/2, CANVAS_HEIGHT/2 + 10);
      } else {
        ctx.fillText('GAME OVER', CANVAS_WIDTH/2, CANVAS_HEIGHT/2 - 20);
      }
      
      ctx.font = "12px 'Press Start 2P', monospace";
      ctx.fillText('PRESS REMATCH TO CONTINUE', CANVAS_WIDTH/2, CANVAS_HEIGHT/2 + 50);
      
      ctx.shadowBlur = 0;
    }
  }, [gameData]);
  useEffect(() => {
    if (gameState === 'playing' && gameData && canvasRef.current) {
      renderGame();
    }
  }, [gameData, gameState, renderGame]);

  const createRoom = () => {
    if (!playerName.trim()) {
      alert('Please enter your name');
      return;
    }
    socket.emit('createRoom', { playerName: playerName.trim() });
  };

  const joinRoom = () => {
    if (!playerName.trim()) {
      alert('Please enter your name');
      return;
    }
    if (!roomCode.trim()) {
      alert('Please enter room code');
      return;
    }
    socket.emit('joinRoom', { 
      playerName: playerName.trim(), 
      roomCode: roomCode.trim().toUpperCase() 
    });
  };

  const startGame = () => {
    socket.emit('startGame');
  };

  const rematchGame = () => {
    socket.emit('restartGame');
  };

  const pauseGame = () => {
    socket.emit('pauseGame');
  };

  const resumeGame = () => {
    socket.emit('resumeGame');
  };

  const stopGame = () => {
    socket.emit('stopGame');
  };

  const backToLobby = () => {
    socket.emit('leaveRoom');
    setGameState('lobby');
    setCurrentRoom(null);
    setPlayers([]);
    setGameData(null);
    setIsHost(false);
  };
  return (
    <div className="app">
      {gameState === 'loading' && (
        <div className="loading">
          <h1>🐍 Multiplayer Snake</h1>
          <div className="loading-spinner"></div>
          <p>Connecting to server...</p>
          <p className="loading-tip">Free servers take up to 50 seconds to wake up after inactivity</p>
        </div>
      )}
      
      {gameState === 'lobby' && (
        <div className="lobby">
          <h1>🐍 Multiplayer Snake</h1>
          {serverStatus === 'error' && (
            <div className="server-error-message">
              <p>⚠️ Server connection error</p>
              <p className="server-error-tip">Game will run in offline mode or with limited functionality</p>
            </div>
          )}
          <div className="form">
            <input
              type="text"
              placeholder="Enter your name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              maxLength={15}
            />
            <input
              type="text"
              placeholder="Room code (optional)"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={6}
            />
            <div className="buttons">
              <button onClick={createRoom} disabled={serverStatus === 'error'}>Create Room</button>
              <button onClick={joinRoom} disabled={serverStatus === 'error'}>Join Room</button>
              {serverStatus === 'error' && (
                <button onClick={() => window.location.reload()}>Retry Connection</button>
              )}
            </div>
          </div>
        </div>
      )}

      {gameState === 'waiting' && (
        <div className="waiting">
          <h2>Room: {currentRoom}</h2>
          <p>Share this code with friends!</p>
          
          <div className="players-list">
            <h3>Players ({players.length}/4):</h3>
            {players.map((player, index) => (
              <div key={player.id} className="player-item">
                🐍 {player.name} {player.isHost && '(Host)'}
              </div>
            ))}
          </div>

          <div className="buttons">
            {isHost && (
              <button onClick={startGame} disabled={players.length < 1}>
                Start Game
              </button>
            )}
            <button onClick={backToLobby}>Leave Room</button>
          </div>
        </div>
      )}

      {(gameState === 'playing' || gameState === 'paused' || gameState === 'gameOver') && (
        <div className="game">
          <div className="game-header">
            <div className="scores">
              {gameData?.players.map((player, index) => (
                <div key={player.id} className={`score ${!player.alive ? 'dead' : ''}`}>
                  <span className="name">{player.name}</span>
                  <span className="points">{player.score}</span>
                  <span className="status">{player.alive ? '🐍' : '💀'}</span>
                </div>
              ))}
            </div>
          </div>

          {gameState === 'paused' && (
            <div className="pause-overlay">
              <h2>Game Paused</h2>
              {isHost && <p>You can resume the game when ready</p>}
              {!isHost && <p>Waiting for host to resume the game...</p>}
            </div>
          )}
          
          {gameState === 'gameOver' && (
            <div className="pause-overlay game-over-overlay">
              <div className="nokia-frame">
                <h2>GAME OVER</h2>
                {gameData?.winner && (
                  <p className="winner-text">{gameData.winner.name} WINS!</p>
                )}
                <div className="buttons">
                  {isHost && (
                    <button className="rematch-btn" onClick={rematchGame}>REMATCH</button>
                  )}
                  {!isHost && (
                    <p className="waiting-text">WAITING FOR HOST...</p>
                  )}
                  <button className="back-btn" onClick={backToLobby}>BACK TO LOBBY</button>
                </div>
              </div>
            </div>
          )}

          <canvas 
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="game-canvas"
          />

          <div className="controls">
            <p>Use WASD or Arrow Keys to move</p>
            <div className="game-controls">
              {isHost && gameState === 'playing' && (
                <button onClick={pauseGame}>Pause Game</button>
              )}
              {isHost && gameState === 'paused' && (
                <button onClick={resumeGame}>Resume Game</button>
              )}
              {isHost && (
                <button onClick={stopGame}>Stop Game</button>
              )}
              <button onClick={backToLobby}>Leave Game</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;