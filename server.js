const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

let players = {};
const THRUST_FACTOR = 0.00015;
const BRAKE_POWER = 0.1;
const FRICTION = 0.99;
const COASTING_FRICTION = 0.9983;
const MAX_SPEED = 200;
const ROTATIONAL_FRICTION_FACTOR = 0.1;
const BASE_PLAYER_RADIUS = 10;
const RESPAWN_TIME = 10000;
const MAP_WIDTH = 5000;
const MAP_HEIGHT = 2800;

wss.on('connection', ws => {
    const playerId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    console.log(`Player ${playerId} connected.`);
    ws.send(JSON.stringify({ type: 'id', id: playerId }));
    const initialAngle = Math.random() * Math.PI * 2;
    players[playerId] = {
        x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, color: `hsl(${Math.random() * 360}, 100%, 50%)`,
        angle: initialAngle, targetAngle: initialAngle, speed: 0,
        isAlive: true, deathTime: 0, radius: BASE_PLAYER_RADIUS,
        keys: { w: false, s: false }, lastProcessedInput: 0,
    };
    ws.on('message', message => {
        const data = JSON.parse(message);
        const player = players[playerId];
        if (!player || data.type !== 'input') return;
        player.keys = data.keys;
        player.targetAngle = data.targetAngle;
        player.lastProcessedInput = data.sequence;
    });
    ws.on('close', () => { console.log(`Player ${playerId} disconnected.`); delete players[playerId]; });
});

setInterval(() => {
    for (const id in players) {
        const player = players[id];
        if (!player.isAlive) {
            if (Date.now() - player.deathTime > RESPAWN_TIME) {
                const newAngle = Math.random() * Math.PI * 2;
                players[id] = {
                    ...players[id], x: MAP_WIDTH / 2 + (Math.random() * 400 - 200), y: MAP_HEIGHT / 2 + (Math.random() * 400 - 200),
                    angle: newAngle, targetAngle: newAngle, speed: 0, isAlive: true, deathTime: 0,
                    radius: BASE_PLAYER_RADIUS, keys: { w: false, s: false }, lastProcessedInput: 0,
                };
            }
            continue;
        }
        let angleDiff = player.targetAngle - player.angle;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        const deltaAngle = Math.abs(angleDiff);
        player.angle = player.targetAngle;
        const rotationalFriction = 1.0 - (deltaAngle * ROTATIONAL_FRICTION_FACTOR);
        player.speed *= rotationalFriction;
        if (player.keys.w) { player.speed += (MAX_SPEED - player.speed) * THRUST_FACTOR; }
        else if (player.keys.s) { player.speed -= BRAKE_POWER; player.speed *= FRICTION; }
        else { player.speed *= COASTING_FRICTION; }
        if (player.speed > MAX_SPEED) player.speed = MAX_SPEED;
        if (player.speed < -MAX_SPEED / 2) player.speed = -MAX_SPEED / 2;
        player.x += player.speed * Math.cos(player.angle);
        player.y += player.speed * Math.sin(player.angle);
        player.radius = BASE_PLAYER_RADIUS * (1 + 30 * (Math.abs(player.speed) / MAX_SPEED));
        player.x = Math.max(player.radius, Math.min(MAP_WIDTH - player.radius, player.x));
        player.y = Math.max(player.radius, Math.min(MAP_HEIGHT - player.radius, player.y));
    }
    const playerIds = Object.keys(players);
    for (let i = 0; i < playerIds.length; i++) { for (let j = i + 1; j < playerIds.length; j++) { const p1 = players[playerIds[i]]; const p2 = players[playerIds[j]]; if (!p1.isAlive || !p2.isAlive) continue; const dx = p1.x - p2.x; const dy = p1.y - p2.y; const distance = Math.sqrt(dx * dx + dy * dy); const p1_hitboxRadius = p1.radius / 4; const p2_hitboxRadius = p2.radius / 4; if (distance < p1_hitboxRadius + p2_hitboxRadius) { let eaten; if (p1.radius > p2.radius) { eaten = p2; } else if (p2.radius > p1.radius) { eaten = p1; } else { continue; } eaten.isAlive = false; eaten.deathTime = Date.now(); eaten.speed = 0; } } }
    const gameState = { type: 'state', players: players };
    wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) { client.send(JSON.stringify(gameState)); } });
}, 1000 / 60);