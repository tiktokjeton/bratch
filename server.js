const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());

// MongoDB-yə qoşulma
const dbURI = 'mongodb+srv://bgl:120225Aa@cluster0.xt29nec.mongodb.net/?appName=Cluster0';
mongoose.connect(dbURI)
  .then(() => console.log('Baza aktivdir!'))
  .catch(err => console.log('Xəta:', err));

// İstifadəçi modeli (məlumatları bazada saxlayır)
const UserSchema = new mongoose.Schema({
    username: String,
    password: String,
    avatar: String,
    following: [String],
    followers: [String]
});
const User = mongoose.model('User', UserSchema);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const activeSockets = {}; 

io.on('connection', (socket) => {
    socket.on('auth', async (data) => {
        const { type, username, password } = data;
        
        if (type === 'register') {
            const existing = await User.findOne({ username });
            if (existing) return socket.emit('auth_response', { success: false, message: 'İstifadəçi var!' });
            await User.create({ username, password, avatar: '', following: [], followers: [] });
            activeSockets[socket.id] = username;
            socket.emit('auth_response', { success: true, username });
        } 
        else if (type === 'login') {
            const user = await User.findOne({ username, password });
            if (!user) return socket.emit('auth_response', { success: false, message: 'Səhv məlumat!' });
            activeSockets[socket.id] = username;
            socket.emit('auth_response', { success: true, username });
        }
    });

    socket.on('disconnect', () => delete activeSockets[socket.id]);
});

server.listen(3000, () => console.log('Server işləyir...'));
