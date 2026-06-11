const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());

// MongoDB bağlantısı
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
    avatar: { type: String, default: '' },
    bio: { type: String, default: '' },
    following: [String],
    followers: [String]
});
const User = mongoose.model('User', UserSchema);

// Post (Keşfet) Modeli
const PostSchema = new mongoose.Schema({
    author: String,
    image: String,
    description: String,
    timestamp: Number,
    likes: { type: Number, default: 0 },
    comments: [{ author: String, text: String }]
});
const Post = mongoose.model('Post', PostSchema);

// Mesaj (Chat) Modeli - YENİ ƏLAVƏ EDİLDİ
const MessageSchema = new mongoose.Schema({
    from: String,
    to: String,
    text: String,
    fileType: String,
    timestamp: { type: Number, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// ==========================================
// 2. SOCKET.IO VƏ SERVER AYARLARI
// ==========================================

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 5e7 // 50MB limitə qaldırıldı ki, şəkillər silinməsin və çökməsin
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
            io.emit('user_status', { username, online: true }); 
            
        } else if (type === 'login') {
            const user = await User.findOne({ username });
            if (!user) {
                return socket.emit('auth_response', { success: false, message: 'Hesabınız yoxdur, zəhmət olmasa hesab yaradın.' });
            }
            if (user.password !== password) {
                return socket.emit('auth_response', { success: false, message: 'Şifrə səhvdir, yenidən yoxlayın.' });
            }
            
            activeSockets[socket.id] = username;
            
            // Giriş edəndə profili də göndər ki, sayt dərhal tanısın
            socket.emit('auth_response', { 
                success: true, 
                username, 
                avatar: user.avatar,
                followersCount: user.followers.length 
            });
            io.emit('user_status', { username, online: true });
        }
    });

    // --- İSTİFADƏÇİ SİYAHISI ---
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

    // --- PROFİL MƏLUMATLARINI GƏTİRMƏK (YENİ) ---
    socket.on('get_user_profile', async (targetUsername) => {
        const user = await User.findOne({ username: targetUsername });
        if(user) {
            socket.emit('user_profile_data', {
                username: user.username,
                avatar: user.avatar,
                bio: user.bio,
                followers: user.followers,
                following: user.following,
                followersCount: user.followers.length,
                followingCount: user.following.length
            });
        }
    });

    // --- FOLLOW / UNFOLLOW SİSTEMİ (YENİ) ---
    socket.on('toggle_follow', async (data) => {
        const { current_user, target_user } = data;
        const me = await User.findOne({ username: current_user });
        const target = await User.findOne({ username: target_user });
        
        if (me && target && current_user !== target_user) {
            if (me.following.includes(target_user)) {
                // İzləmədən çıxart (Unfollow)
                me.following = me.following.filter(u => u !== target_user);
                target.followers = target.followers.filter(u => u !== current_user);
            } else {
                // İzlə (Follow)
                me.following.push(target_user);
                target.followers.push(current_user);
            }
            await me.save();
            await target.save();
            
            // Hər kəsə yeni rəqəmləri göndər
            io.emit('follow_updated', { 
                target_user, 
                followersCount: target.followers.length 
            });
        }
    });

    // --- KEŞFET VƏ POSTLAR ---
    socket.on('create_post', async (postData) => {
        await Post.create({
            author: postData.author,
            image: postData.image,
            description: postData.description,
            timestamp: postData.timestamp || Date.now()
        });
        
        const allPosts = await Post.find().sort({ timestamp: -1 }); // Ən yenilər üstdə
        io.emit('explore_posts', allPosts);
    });

    socket.on('get_explore_posts', async () => {
        const allPosts = await Post.find().sort({ timestamp: -1 });
        socket.emit('explore_posts', allPosts);
    });

    // --- MESAJLAŞMA (Chat) VƏ BİLDİRİŞLƏR ---
    socket.on('private_message', async (msgData) => {
        const { to, text, fileType } = msgData;
        const from = activeSockets[socket.id];
        if(!from) return;
        
        // Mesajı bazaya yaz (artıq oflayn olanda da silinməyəcək)
        const newMessage = await Message.create({ 
            from, to, text, fileType, timestamp: Date.now() 
        });
        
        const messageObj = { from, to, text, fileType, timestamp: newMessage.timestamp };
        
        // Özünə göndər
        socket.emit('msg_receive', messageObj);
        
        // Qarşı tərəf onlayndırsa dərhal göndər və bildiriş ver
        for (let [id, uname] of Object.entries(activeSockets)) {
            if (uname === to) {
                io.to(id).emit('msg_receive', messageObj);
                io.to(id).emit('new_notification', { from, text: 'Sizə yeni mesaj var!' }); // Bildiriş
            }
        }
    });

    // Keçmiş mesajları yükləmək (YENİ)
    socket.on('get_chat_history', async (data) => {
        const { user1, user2 } = data;
        const history = await Message.find({
            $or: [
                { from: user1, to: user2 },
                { from: user2, to: user1 }
            ]
        }).sort({ timestamp: 1 });
        socket.emit('chat_history', history);
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
            
            if(data.avatar) {
                socket.emit('avatar_updated', { username, avatar: data.avatar });
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
