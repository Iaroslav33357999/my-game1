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
const ADMIN_PASSWORD = "Iaroslav_33357999!";

// Улучшенная конфигурация мира
const WORLD_CONFIG = {
    PLATFORM_SPACING: 12,
    PLATFORM_WIDTH: 18,
    PLATFORM_DEPTH: 18,
    SPAWN_POSITION: { x: 0, y: 1.7, z: 0 },
    SPAWN_PLATFORM_POSITION: { x: 0, y: 0, z: 0 },
    GENERATION_DISTANCE: 150,
    MAX_PLATFORMS: 1000, // Увеличено для бесконечной генерации
    WORLD_HEIGHT_LIMIT: -5000 // Максимальная глубина мира
};

// ФИКС: Детерминированная генерация платформ с движущимися элементами
function getPlatformPosition(index, isSpawn = false) {
    if (isSpawn) {
        return { x: 0, y: 0, z: 0 };
    }
    
    const y = -index * WORLD_CONFIG.PLATFORM_SPACING;
    const z = -index * 25;
    
    // Детерминированный RNG на основе индекса
    const seed = index * 9301 + 49297;
    const rand = (seed % 233280) / 233280;
    
    const x = (rand - 0.5) * 100;
    
    return { x, y, z };
}

// Функция для определения типа платформы на основе индекса
function getPlatformType(index) {
    if (index === 0) return 'spawn';
    
    const types = ['normal', 'moving', 'jump', 'rotating', 'narrow', 'item'];
    const seed = index * 12345 + 67890;
    
    // Распределение типов платформ
    if (index < 10) return 'normal'; // Первые 10 платформ - обычные
    
    const rand = (seed % 1000) / 1000;
    
    if (rand < 0.5) return 'normal';      // 50% - обычные
    if (rand < 0.65) return 'moving';     // 15% - движущиеся
    if (rand < 0.75) return 'jump';       // 10% - прыжковые
    if (rand < 0.85) return 'rotating';   // 10% - вращающиеся
    if (rand < 0.92) return 'narrow';     // 7% - узкие
    return 'item';                        // 8% - с предметами
}

io.on('connection', (socket) => {
    socket.data.isAdmin = false;
    socket.data.lastAudioTime = Date.now();
    socket.data.respawnCooldown = false;
    socket.data.lastRespawnTime = 0;
    socket.data.distanceTraveled = 0; // Дистанция от спавна
    socket.data.startPosition = { x: 0, y: 1.7, z: 0 }; // Стартовая позиция

    socket.on('initPlayer', (nick) => {
        const safeNick = nick.replace(/</g, "&lt;").replace(/>/g, "&gt;").substring(0, 14);
        
        players[socket.id] = { 
            id: socket.id, 
            nick: safeNick || "Anon", 
            x: WORLD_CONFIG.SPAWN_POSITION.x, 
            y: WORLD_CONFIG.SPAWN_POSITION.y, 
            z: WORLD_CONFIG.SPAWN_POSITION.z,
            lastAudioTime: Date.now(),
            respawnCooldown: false,
            lastRespawnTime: 0,
            distanceTraveled: 0,
            startPosition: { ...WORLD_CONFIG.SPAWN_POSITION },
            stats: {
                maxStamina: 100,
                maxFuel: 100,
                stamina: 100,
                fuel: 100,
                staminaBoosts: 0,
                fuelBoosts: 0
            }
        };
        
        socket.emit('worldConfig', {
            ...WORLD_CONFIG,
            getPlatformType: null
        });
        
        socket.emit('teleport', WORLD_CONFIG.SPAWN_POSITION);
        socket.emit('playerStats', players[socket.id].stats);
        
        io.emit('currentPlayers', players);
        io.emit('receiveMessage', { 
            nick: 'СИСТЕМА', 
            msg: `${safeNick} вошел в сеть`, 
            type: 'sys' 
        });
    });

    socket.on('move', (data) => {
        if (players[socket.id]) {
            const player = players[socket.id];
            
            // Обновляем позицию
            player.x = data.x;
            player.y = data.y;
            player.z = data.z;
            
            // Рассчитываем дистанцию от старта (по Y-координате)
            const distance = Math.abs(player.startPosition.y - player.y);
            player.distanceTraveled = Math.max(player.distanceTraveled, distance);
            
            // Отправляем обновленную дистанцию игроку
            socket.emit('updateDistance', Math.floor(player.distanceTraveled));
            
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

    // Сбор предметов
    socket.on('collectItem', (itemType) => {
        const player = players[socket.id];
        if (!player) return;
        
        if (itemType === 'stamina') {
            player.stats.maxStamina = Math.min(200, player.stats.maxStamina + 25);
            player.stats.staminaBoosts++;
            
            socket.emit('playerStats', player.stats);
            socket.emit('receiveMessage', {
                nick: 'СИСТЕМА',
                msg: `⚡ Максимальная выносливость увеличена до ${player.stats.maxStamina}%`,
                type: 'sys'
            });
            
        } else if (itemType === 'fuel') {
            player.stats.maxFuel = Math.min(200, player.stats.maxFuel + 25);
            player.stats.fuelBoosts++;
            
            socket.emit('playerStats', player.stats);
            socket.emit('receiveMessage', {
                nick: 'СИСТЕМА',
                msg: `🛢️ Максимальное топливо увеличено до ${player.stats.maxFuel}%`,
                type: 'sys'
            });
        }
    });

    // ФИКС: Улучшенный респавн с проверкой
    socket.on('requestRespawn', () => {
        const player = players[socket.id];
        if (!player) return;
        
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
        player.distanceTraveled = 0;
        
        setTimeout(() => {
            if (players[socket.id]) {
                players[socket.id].respawnCooldown = false;
                socket.emit('respawnCooldownEnd');
            }
        }, 3000);
        
        player.x = WORLD_CONFIG.SPAWN_POSITION.x;
        player.y = WORLD_CONFIG.SPAWN_POSITION.y;
        player.z = WORLD_CONFIG.SPAWN_POSITION.z;
        
        console.log(`[РЕСПАВН] Игрок ${player.nick} телепортирован на спавн`);
        
        socket.emit('teleport', WORLD_CONFIG.SPAWN_POSITION);
        socket.emit('updateDistance', 0);
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
                    msg: 'Команды: /login [пароль], /tp [ник], /fly, /nofly, /kill [ник], /respawn, /pos, /stats, /distance' 
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

            if (cmd === 'distance') {
                socket.emit('receiveMessage', { 
                    nick: 'СЕРВЕР', 
                    msg: `Пройдено от спавна: ${Math.floor(player.distanceTraveled)} метров`, 
                    type: 'sys' 
                });
                return;
            }

            if (cmd === 'stats') {
                socket.emit('receiveMessage', { 
                    nick: 'СЕРВЕР', 
                    msg: `Статистика: Выносливость ${player.stats.maxStamina}% (${player.stats.staminaBoosts} бустов), Топливо ${player.stats.maxFuel}% (${player.stats.fuelBoosts} бустов)`, 
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
                player.distanceTraveled = 0;
                
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
                socket.emit('updateDistance', 0);
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
                    target.distanceTraveled = 0;
                    io.to(target.id).emit('teleport', WORLD_CONFIG.SPAWN_POSITION);
                    io.to(target.id).emit('updateDistance', 0);
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
