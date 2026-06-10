const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Serverin işlədiyini brauzerdə görmək üçün bəsit ana səhifə
app.get('/', (req, res) => {
    res.send('Server tam qaydasında işləyir, brat!');
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log('Bir istifadəçi qoşuldu');
    
    socket.on('chat_message', (data) => {
        io.emit('chat_message', data);
    });

    socket.on('disconnect', () => {
        console.log('İstifadəçi ayrıldı');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server ${PORT} portunda aktivdir...`);
});
