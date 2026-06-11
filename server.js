const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());

// MongoDB bağlantısı (Sənin verdiyin original link)
const dbURI = 'mongodb+srv://bgl:120225Aa@cluster0.xt29nec.mongodb.net/?appName=Cluster0';
mongoose.connect(dbURI)
  .then(() => console.log('Brat, Baza (MongoDB) aktivdir!'))
  .catch(err => console.log('Baza xətası:', err));

// ==========================================
// 1. MƏLUMAT BAZASI MODELLƏRİ (Mongoose)
// ==========================================

// İstifadəçi Modeli
const UserSchema = new mongoose.Schema({
    username: String,
    password: String,
    avatar: String,
    bio: { type: String, default: '' },
    following: [String],
    followers: [String]
});
const User = mongoose.model('User', UserSchema);

// Post (Keşfet) Modeli - Yeni əlavə edildi
const PostSchema = new mongoose.Schema({
    author: String,
    image: String,
    description: String,
    timestamp: Number,
    likes: { type: Number, default: 0 },
    comments: [{ author: String, text: String }]
});
const Post = mongoose.model('Post', PostSchema);

// ==========================================
// 2. SOCKET.IO VƏ SERVER AYARLARI
// ==========================================

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e7 // 10MB limit (şəkillər üçün)
});

const activeSockets = {}; // Kimlərin online olduğunu izləmək üçün

io.on('connection', (socket) => {
    
    // --- AUTH (Qeydiyyat və Giriş) ---
    socket.on('auth', async (data) => {
        const { type, username, password } = data;
        
        if (type === 'register') {
            const existing = await User.findOne({ username });
            if (existing) {
                return socket.emit('auth_response', { success: false, message: 'Bu adda istifadəçi artıq var, başqa ad seçin.' });
            }
            await User.create({ username, password, avatar: '', bio: '', following: [], followers: [] });
            activeSockets[socket.id] = username;
            socket.emit('auth_response', { success: true, username });
            io.emit('user_status', { username, online: true }); // Hamıya online olduğunu bildir
            
        } else if (type === 'login') {
            const user = await User.findOne({ username });
            // İSTƏDİYİN XƏTA MESAJI: Hesab yoxdursa
            if (!user) {
                return socket.emit('auth_response', { success: false, message: 'Hesabınız yoxdur, zəhmət olmasa hesab yaradın.' });
            }
            // Şifrə səhvdirsə
            if (user.password !== password) {
                return socket.emit('auth_response', { success: false, message: 'Şifrə səhvdir, yenidən yoxlayın.' });
            }
            
            activeSockets[socket.id] = username;
            socket.emit('auth_response', { success: true, username });
            io.emit('user_status', { username, online: true });
        }
    });

    // --- İSTİFADƏÇİ SİYAHISI (Axtarış ekranı üçün) ---
    socket.on('get_users', async () => {
        const users = await User.find({});
        const userList = users.map(u => ({
            username: u.username,
            avatar: u.avatar,
            followersCount: u.followers.length,
            online: Object.values(activeSockets).includes(u.username)
        }));
        socket.emit('user_list', userList);
    });

    // --- KEŞFET VƏ POSTLAR ---
    // Yeni post paylaşılanda
    socket.on('create_post', async (postData) => {
        await Post.create({
            author: postData.author,
            image: postData.image,
            description: postData.description,
            timestamp: postData.timestamp || Date.now()
        });
        
        // Bütün postları yenidən çəkib hamıya göndəririk
        const allPosts = await Post.find().sort({ timestamp: 1 });
        io.emit('explore_posts', allPosts);
    });

    // Keşfetə girəndə postları gətirmək
    socket.on('get_explore_posts', async () => {
        const allPosts = await Post.find().sort({ timestamp: 1 });
        socket.emit('explore_posts', allPosts);
    });

    // --- MESAJLAŞMA (Chat) ---
    socket.on('private_message', (msgData) => {
        const { to, text, fileType } = msgData;
        const from = activeSockets[socket.id];
        
        const messageObj = { from, to, text, fileType };
        
        // Özünə göndər (ekranda görmək üçün)
        socket.emit('msg_receive', messageObj);
        
        // Qarşı tərəfə göndər (əgər onlayndırsa)
        for (let [id, uname] of Object.entries(activeSockets)) {
            if (uname === to) {
                io.to(id).emit('msg_receive', messageObj);
            }
        }
    });

    // --- YAZIR... FUNKSİYASI ---
    socket.on('typing', (data) => {
        for (let [id, uname] of Object.entries(activeSockets)) {
            if (uname === data.to) {
                io.to(id).emit('typing', { from: activeSockets[socket.id] });
            }
        }
    });

    socket.on('stop_typing', (data) => {
        for (let [id, uname] of Object.entries(activeSockets)) {
            if (uname === data.to) {
                io.to(id).emit('stop_typing', { from: activeSockets[socket.id] });
            }
        }
    });

    // --- PROFİL YENİLƏMƏ ---
    socket.on('update_profile', async (data) => {
        const username = activeSockets[socket.id];
        if (username) {
            await User.updateOne({ username }, { bio: data.bio, avatar: data.avatar });
            socket.emit('profile_updated', { success: true });
            
            // Avatar dəyişibsə xüsusi olaraq bildir
            if(data.avatar) {
                socket.emit('avatar_updated', data.avatar);
            }
        }
    });

    // --- ÇIXIŞ (Disconnect) ---
    socket.on('disconnect', () => {
        const username = activeSockets[socket.id];
        if (username) {
            io.emit('user_status', { username, online: false });
            delete activeSockets[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server ${PORT}-cu portda işləyir, uğurlar brat...`));
