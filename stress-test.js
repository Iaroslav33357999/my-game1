const io = require('socket.io-client');

class StressTester {
    constructor(serverUrl, ratePerSecond = 1000) {
        this.serverUrl = serverUrl;
        this.ratePerSecond = ratePerSecond;
        this.sockets = new Map();
        this.counter = 0;
        this.isRunning = false;
    }

    createFakePlayer() {
        const playerId = `stress_${Date.now()}_${this.counter++}`;
        const nick = `Bot_${Math.floor(Math.random() * 10000)}`;
        
        try {
            const socket = io(this.serverUrl, {
                transports: ['websocket'],
                reconnection: false,
                timeout: 5000
            });

            socket.on('connect', () => {
                console.log(`[${new Date().toISOString()}] Подключен: ${playerId} (${nick})`);
                
                // Инициализируем игрока
                socket.emit('initPlayer', nick);
                
                // Случайные движения
                const moveInterval = setInterval(() => {
                    if (socket.connected) {
                        const x = Math.random() * 100 - 50;
                        const y = Math.random() * 50;
                        const z = Math.random() * 100 - 50;
                        socket.emit('move', { x, y, z, nick });
                    }
                }, Math.random() * 5000 + 1000);

                // Случайные сообщения в чат
                const chatInterval = setInterval(() => {
                    if (socket.connected) {
                        const messages = [
                            'Привет!',
                            'Как дела?',
                            'Тестовое сообщение',
                            'Стресс-тест в процессе',
                            'Бот онлайн',
                            'Пинг?',
                            'Работает!'
                        ];
                        const msg = messages[Math.floor(Math.random() * messages.length)];
                        socket.emit('chatMessage', msg);
                    }
                }, Math.random() * 10000 + 5000);

                this.sockets.set(playerId, {
                    socket,
                    intervals: [moveInterval, chatInterval]
                });
            });

            socket.on('disconnect', () => {
                console.log(`[${new Date().toISOString()}] Отключен: ${playerId}`);
                this.cleanupPlayer(playerId);
            });

            socket.on('connect_error', (err) => {
                console.log(`[${new Date().toISOString()}] Ошибка подключения ${playerId}:`, err.message);
                this.cleanupPlayer(playerId);
            });

            socket.on('error', (err) => {
                console.log(`[${new Date().toISOString()}] Ошибка сокета ${playerId}:`, err);
                this.cleanupPlayer(playerId);
            });

            // Автоотключение через случайное время (30-120 секунд)
            setTimeout(() => {
                if (socket.connected) {
                    socket.disconnect();
                }
            }, Math.random() * 90000 + 30000);

        } catch (error) {
            console.log(`[${new Date().toISOString()}] Ошибка создания игрока ${playerId}:`, error.message);
        }
    }

    cleanupPlayer(playerId) {
        const data = this.sockets.get(playerId);
        if (data) {
            data.intervals.forEach(interval => clearInterval(interval));
            if (data.socket.connected) {
                data.socket.disconnect();
            }
            this.sockets.delete(playerId);
        }
    }

    start() {
        if (this.isRunning) {
            console.log('Тест уже запущен');
            return;
        }

        this.isRunning = true;
        console.log(`🚀 Запуск стресс-теста на ${this.serverUrl}`);
        console.log(`📊 Целевая нагрузка: ${this.ratePerSecond} подключений/сек`);
        console.log('Нажмите Ctrl+C для остановки\n');

        // Создаем подключения с заданной частотой
        this.interval = setInterval(() => {
            this.createFakePlayer();
            
            // Периодически выводим статистику
            if (this.counter % 100 === 0) {
                const active = Array.from(this.sockets.values())
                    .filter(data => data.socket.connected).length;
                console.log(`📈 Статистика: Всего создано: ${this.counter}, Активно: ${active}`);
            }
        }, 1000 / this.ratePerSecond);

        // Очистка мертвых подключений каждые 10 секунд
        this.cleanupInterval = setInterval(() => {
            let disconnected = 0;
            for (const [id, data] of this.sockets.entries()) {
                if (!data.socket.connected) {
                    this.cleanupPlayer(id);
                    disconnected++;
                }
            }
            if (disconnected > 0) {
                console.log(`🧹 Очищено отключенных: ${disconnected}`);
            }
        }, 10000);
    }

    stop() {
        if (!this.isRunning) {
            console.log('Тест не запущен');
            return;
        }

        this.isRunning = false;
        clearInterval(this.interval);
        clearInterval(this.cleanupInterval);
        
        console.log('\n🛑 Остановка стресс-теста...');
        console.log(`Всего создано подключений: ${this.counter}`);
        
        // Отключаем все сокеты
        let disconnected = 0;
        for (const [id] of this.sockets.entries()) {
            this.cleanupPlayer(id);
            disconnected++;
        }
        
        console.log(`Отключено сокетов: ${disconnected}`);
        console.log('Стресс-тест завершен');
    }

    getStats() {
        const active = Array.from(this.sockets.values())
            .filter(data => data.socket.connected).length;
        return {
            totalCreated: this.counter,
            currentlyActive: active,
            ratePerSecond: this.ratePerSecond,
            isRunning: this.isRunning
        };
    }
}

// Использование
const tester = new StressTester('http://localhost:3000', 1000); // 1000 подключений в секунду

// Запуск теста
tester.start();

// Для остановки (если запускаете из командной строки)
process.on('SIGINT', () => {
    console.log('\nПолучен сигнал SIGINT (Ctrl+C)');
    tester.stop();
    process.exit(0);
});

// Вывод статистики каждые 30 секунд
setInterval(() => {
    const stats = tester.getStats();
    console.log('\n📊 === СТАТИСТИКА ===');
    console.log(`Всего создано: ${stats.totalCreated}`);
    console.log(`Активных сейчас: ${stats.currentlyActive}`);
    console.log(`Скорость: ${stats.ratePerSecond}/сек`);
    console.log(`Статус: ${stats.isRunning ? 'Запущен' : 'Остановлен'}`);
    console.log('===================\n');
}, 30000);