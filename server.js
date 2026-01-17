const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    maxHttpBufferSize: 1e7,
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingInterval: 10000,
    pingTimeout: 5000
});

app.use(express.static(__dirname));

app.get('/get-music', (req, res) => {
    const musicFolder = __dirname;
    fs.readdir(musicFolder, (err, files) => {
        if (err) return res.status(500).send("Ошибка чтения папки");
        const mp3Files = files.filter(file => file.endsWith('.mp3'));
        res.json(mp3Files);
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const players = {};
const ADMIN_PASSWORD = "Iaroslav_33357999!"; // ИЗМЕНЕН ПАРОЛЬ

// ФИКС: Исправлены координаты спавна
const WORLD_CONFIG = {
    PLATFORM_SPACING: 12,
    PLATFORM_WIDTH: 18,
    PLATFORM_DEPTH: 18,
    SPAWN_POSITION: { x: 0, y: 1.7, z: 0 }, // ФИКС: y=1.7 (высота игрока над платформой)
    SPAWN_PLATFORM_POSITION: { x: 0, y: 0, z: 0 }, // ФИКС: Позиция платформы спавна
    GENERATION_DISTANCE: 150, // УВЕЛИЧЕНО С 50 ДО 150
    MAX_PLATFORMS: 400 // УВЕЛИЧЕНО С 200 ДО 400
};

// ФИКС: Детерминированная генерация платформ
function getPlatformPosition(index, isSpawn = false) {
    if (isSpawn) {
        return { x: 0, y: 0, z: 0 }; // ФИКС: Спавн платформа всегда на (0,0,0)
    }
    
    const y = -index * WORLD_CONFIG.PLATFORM_SPACING;
    const z = -index * 25;
    
    // Детерминированный RNG на основе индекса
    const seed = index * 9301 + 49297;
    const rand = (seed % 233280) / 233280;
    
    const x = (rand - 0.5) * 100;
    
    return { x, y, z };
}

io.on('connection', (socket) => {
    socket.data.isAdmin = false;
    socket.data.lastAudioTime = Date.now();
    socket.data.respawnCooldown = false;
    socket.data.lastRespawnTime = 0;

    socket.on('initPlayer', (nick) => {
        const safeNick = nick.replace(/</g, "&lt;").replace(/>/g, "&gt;").substring(0, 14);
        
        // ФИКС: Инициализируем игрока точно на спавне
        players[socket.id] = { 
            id: socket.id, 
            nick: safeNick || "Anon", 
            x: WORLD_CONFIG.SPAWN_POSITION.x, 
            y: WORLD_CONFIG.SPAWN_POSITION.y, 
            z: WORLD_CONFIG.SPAWN_POSITION.z,
            lastAudioTime: Date.now(),
            respawnCooldown: false,
            lastRespawnTime: 0
        };
        
        // ФИКС: Отправляем полную конфигурацию мира
        socket.emit('worldConfig', {
            ...WORLD_CONFIG,
            getPlatformPosition: null // Не отправляем функцию
        });
        
        // ФИКС: Сразу отправляем позицию спавна
        socket.emit('teleport', WORLD_CONFIG.SPAWN_POSITION);
        
        io.emit('currentPlayers', players);
        io.emit('receiveMessage', { 
            nick: 'СИСТЕМА', 
            msg: `${safeNick} вошел в сеть`, 
            type: 'sys' 
        });
    });

    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            socket.broadcast.emit('playerMoved', { 
                id: socket.id, 
                x: data.x, 
                y: data.y, 
                z: data.z 
            });
        }
    });

    socket.on('audioStream', (buffer) => {
        const sender = players[socket.id];
        if (!sender) return;
        
        sender.lastAudioTime = Date.now();
        
        for (const [targetId, target] of Object.entries(players)) {
            if (targetId === socket.id) continue;
            
            const distSq = 
                Math.pow(sender.x - target.x, 2) + 
                Math.pow(sender.y - target.y, 2) + 
                Math.pow(sender.z - target.z, 2);
            
            if (distSq < 3600) {
                io.to(targetId).volatile.emit('audioStream', { 
                    id: socket.id, 
                    buffer: buffer, 
                    pos: { x: sender.x, y: sender.y, z: sender.z }
                });
            }
        }
    });

    socket.on('audioHeartbeat', () => {
        if (players[socket.id]) {
            players[socket.id].lastAudioTime = Date.now();
        }
    });

    // ФИКС: Улучшенный респавн с проверкой
    socket.on('requestRespawn', () => {
        const player = players[socket.id];
        if (!player) return;
        
        const now = Date.now();
        const cooldownRemaining = 3000 - (now - player.lastRespawnTime);
        
        // Проверка кулдауна
        if (cooldownRemaining > 0 && now - player.lastRespawnTime < 3000) {
            socket.emit('receiveMessage', { 
                nick: 'СЕРВЕР', 
                msg: `Респавн на кулдауне, подождите ${Math.ceil(cooldownRemaining/1000)} сек.`, 
                type: 'sys' 
            });
            return;
        }
        
        // Устанавливаем кулдаун
        player.lastRespawnTime = now;
        player.respawnCooldown = true;
        
        // ФИКС: Таймер для сброса кулдауна
        setTimeout(() => {
            if (players[socket.id]) {
                players[socket.id].respawnCooldown = false;
                socket.emit('respawnCooldownEnd');
            }
        }, 3000);
        
        // ФИКС: Телепортируем точно на спавн
        player.x = WORLD_CONFIG.SPAWN_POSITION.x;
        player.y = WORLD_CONFIG.SPAWN_POSITION.y;
        player.z = WORLD_CONFIG.SPAWN_POSITION.z;
        
        console.log(`[РЕСПАВН] Игрок ${player.nick} телепортирован на:`, WORLD_CONFIG.SPAWN_POSITION);
        
        socket.emit('teleport', WORLD_CONFIG.SPAWN_POSITION);
        socket.emit('receiveMessage', { 
            nick: 'СЕРВЕР', 
            msg: 'Вы телепортированы на точку спавна', 
            type: 'sys' 
        });
        
        io.emit('receiveMessage', { 
            nick: 'СИСТЕМА', 
            msg: `${player.nick} воспользовался респавном`, 
            type: 'sys' 
        });
    });

    socket.on('chatMessage', (msg) => {
        const player = players[socket.id];
        if (!player) return;
        
        if (msg.length > 200) msg = msg.substring(0, 200);

        if (msg.startsWith('/')) {
            const args = msg.slice(1).split(' ');
            const cmd = args[0].toLowerCase();

            if (cmd === 'help') {
                socket.emit('receiveMessage', { 
                    nick: 'СЕРВЕР', 
                    msg: 'Команды: /login [пароль], /tp [ник], /fly, /nofly, /kill [ник], /respawn, /pos' 
                });
                return;
            }

            if (cmd === 'login') {
                if (args[1] === ADMIN_PASSWORD) {
                    socket.data.isAdmin = true;
                    socket.emit('receiveMessage', { 
                        nick: 'СЕРВЕР', 
                        msg: 'Вы получили права администратора! 🔓', 
                        type: 'sys' 
                    });
                } else {
                    socket.emit('receiveMessage', { 
                        nick: 'СЕРВЕР', 
                        msg: 'Неверный пароль ⛔', 
                        type: 'sys' 
                    });
                }
                return;
            }

            if (cmd === 'pos') {
                socket.emit('receiveMessage', { 
                    nick: 'СЕРВЕР', 
                    msg: `Ваша позиция: X=${player.x.toFixed(2)}, Y=${player.y.toFixed(2)}, Z=${player.z.toFixed(2)}`, 
                    type: 'sys' 
                });
                return;
            }

            if (cmd === 'respawn') {
                const now = Date.now();
                const cooldownRemaining = 3000 - (now - player.lastRespawnTime);
                
                if (cooldownRemaining > 0 && now - player.lastRespawnTime < 3000) {
                    socket.emit('receiveMessage', { 
                        nick: 'СЕРВЕР', 
                        msg: `Респавн на кулдауне, подождите ${Math.ceil(cooldownRemaining/1000)} сек.`, 
                        type: 'sys' 
                    });
                    return;
                }
                
                player.lastRespawnTime = now;
                player.respawnCooldown = true;
                
                setTimeout(() => {
                    if (players[socket.id]) {
                        players[socket.id].respawnCooldown = false;
                        socket.emit('respawnCooldownEnd');
                    }
                }, 3000);
                
                player.x = WORLD_CONFIG.SPAWN_POSITION.x;
                player.y = WORLD_CONFIG.SPAWN_POSITION.y;
                player.z = WORLD_CONFIG.SPAWN_POSITION.z;
                
                socket.emit('teleport', WORLD_CONFIG.SPAWN_POSITION);
                socket.emit('receiveMessage', { 
                    nick: 'СЕРВЕР', 
                    msg: 'Вы телепортированы на точку спавна' 
                });
                return;
            }

            if (!socket.data.isAdmin) {
                socket.emit('receiveMessage', { 
                    nick: 'СЕРВЕР', 
                    msg: 'У вас нет прав. Используйте /login [пароль]', 
                    type: 'sys' 
                });
                return;
            }

            if (cmd === 'tp') {
                const target = Object.values(players).find(p => p.nick === args[1]);
                if (target) {
                    socket.emit('teleport', { x: target.x, y: target.y + 2, z: target.z });
                    socket.emit('receiveMessage', { 
                        nick: 'СЕРВЕР', 
                        msg: `Телепортация к ${target.nick}` 
                    });
                }
            } else if (cmd === 'kill') {
                const target = Object.values(players).find(p => p.nick === args[1]);
                if (target) {
                    io.to(target.id).emit('teleport', WORLD_CONFIG.SPAWN_POSITION);
                    io.emit('receiveMessage', { 
                        nick: 'СИСТЕМА', 
                        msg: `${target.nick} был телепортирован на спавн администратором`, 
                        type: 'sys' 
                    });
                }
            } else if (cmd === 'fly') { 
                socket.emit('setFly', true);
            } else if (cmd === 'nofly') { 
                socket.emit('setFly', false); 
            }
        } else {
            io.emit('receiveMessage', { nick: player.nick, msg, type: 'chat' });
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            const nick = players[socket.id].nick;
            delete players[socket.id];
            io.emit('playerLeft', socket.id);
            io.emit('receiveMessage', { 
                nick: 'СИСТЕМА', 
                msg: `${nick} вышел из игры`, 
                type: 'sys' 
            });
        }
    });
});

setInterval(() => {
    const now = Date.now();
    for (const [id, player] of Object.entries(players)) {
        if (now - player.lastAudioTime > 30000) {
            player.lastAudioTime = now;
        }
    }
}, 10000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
    console.log(`Игра: Neon&Talk | Автор: YANFUN TEAM`);
    console.log(`Конфигурация мира:`, WORLD_CONFIG);
    console.log(`Спавн: X=${WORLD_CONFIG.SPAWN_POSITION.x}, Y=${WORLD_CONFIG.SPAWN_POSITION.y}, Z=${WORLD_CONFIG.SPAWN_POSITION.z}`);
});
