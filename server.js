
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

let allStrokesMemory = [];
let claimedAreas = {}; // { "X,Y": { username, x, y, width, height, isForSale, price } }
let userLikes = {};    
let likedSlots = {};   
let activeUsers = {}; 

app.use(express.static('public'));

function getMaxAreasAllowed(username) {
    const likes = userLikes[username] || 0;
    return 1 + Math.floor(likes / 5);
}

function countUserCurrentAreas(username) {
    let count = 0;
    for (let slotId in claimedAreas) {
        if (claimedAreas[slotId].username === username) count++;
    }
    return count;
}

io.on('connection', (socket) => {
    console.log(`Kullanıcı bağlandı: ${socket.id}`);

    socket.emit('canvas-history', { 
        strokes: allStrokesMemory, 
        areas: claimedAreas,
        likes: userLikes
    });

    socket.on('register-user', (username) => {
        activeUsers[socket.id] = username;
        if (!userLikes[username]) userLikes[username] = 0;
        io.emit('sync-areas', { areas: claimedAreas, likes: userLikes });
    });

    // --- 💰 ARSAYI SATILIĞA ÇIKARMA SİSTEMİ ---
    socket.on('put-for-sale', (data) => {
        const { slotId, username, price } = data;
        const area = claimedAreas[slotId];

        if (area && area.username === username) {
            area.isForSale = true;
            area.price = parseInt(price) || 0;
            io.emit('sync-areas', { areas: claimedAreas, likes: userLikes });
        }
    });

    // --- 🧱 PARSEL CLAIM VE SATIN ALMA SİSTEMİ ---
    socket.on('claim-area', (newArea) => {
        const slotId = `${newArea.x},${newArea.y}`;
        const existingArea = claimedAreas[slotId];

        // EĞER ARSA BİRİSİNİNSE VE SATILIKSA (SATIN ALMA MOTORU)
        if (existingArea) {
            if (existingArea.isForSale) {
                const buyer = newArea.username;
                const seller = existingArea.username;
                const price = existingArea.price;

                if (buyer === seller) return socket.emit('security-warning', 'Kendi arsanızı satın alamazsınız!');

                // Alıcının yeterli parası (Like'ı) var mı?
                const buyerLikes = userLikes[buyer] || 0;
                if (buyerLikes < price) {
                    return socket.emit('security-warning', `Bu arsa için yeterli beğeniniz yok! Gerekli: ❤️${price}, Sizde Olan: ❤️${buyerLikes}`);
                }

                // Alıcının toplam parsel limiti bu yeni satın almayla aşılıyor mu?
                const maxAllowed = getMaxAreasAllowed(buyer);
                const currentOwned = countUserCurrentAreas(buyer);
                if (currentOwned >= maxAllowed) {
                    return socket.emit('security-warning', `Arsa limitiniz dolu (${currentOwned}/${maxAllowed}). Önce bir arsanızı satmalı veya limit arttırmalısınız.`);
                }

                // Emlak Transferi Gerçekleşiyor
                userLikes[buyer] -= price;
                if (!userLikes[seller]) userLikes[seller] = 0;
                userLikes[seller] += price;

                existingArea.username = buyer;
                existingArea.isForSale = false;
                existingArea.price = 0;

                return io.emit('sync-areas', { areas: claimedAreas, likes: userLikes });
            } else {
                return socket.emit('security-warning', 'Bu arsa zaten mühürlenmiş ve satılık değil!');
            }
        }

        // ARSA BOŞSA (NORMAL SAHİPLENME)
        const maxAllowed = getMaxAreasAllowed(newArea.username);
        const currentOwned = countUserCurrentAreas(newArea.username);

        if (currentOwned >= maxAllowed) {
            const nextMilestone = maxAllowed * 5;
            const currentLikes = userLikes[newArea.username] || 0;
            return socket.emit('security-warning', `Parsel limitine ulaştınız. Yeni alan için ${nextMilestone - currentLikes} like daha lazım!`);
        }

        claimedAreas[slotId] = {
            username: newArea.username,
            x: newArea.x,
            y: newArea.y,
            width: 300,
            height: 300,
            isForSale: false,
            price: 0
        };

        io.emit('sync-areas', { areas: claimedAreas, likes: userLikes });
    });

    // --- ❤️ LIKE SİSTEMİ ---
    socket.on('like-slot', (data) => {
        const { slotId, targetUser, myUsername } = data;
        const voteKey = `${myUsername}_${slotId}`;

        if (targetUser === myUsername) return socket.emit('security-warning', 'Kendi çiziminizi beğenemezsiniz! 😉');
        if (likedSlots[voteKey]) return socket.emit('security-warning', 'Bu parseli zaten beğendiniz!');

        likedSlots[voteKey] = true;
        if (!userLikes[targetUser]) userLikes[targetUser] = 0;
        userLikes[targetUser] += 1;

        io.emit('sync-areas', { areas: claimedAreas, likes: userLikes });
    });

    socket.on('new-stroke', (strokeData) => {
        allStrokesMemory.push(strokeData);
        socket.broadcast.emit('broadcast-stroke', strokeData);
    });

    socket.on('undo-stroke', (username) => {
        for (let i = allStrokesMemory.length - 1; i >= 0; i--) {
            if (allStrokesMemory[i].creator === username) {
                allStrokesMemory.splice(i, 1);
                break;
            }
        }
        io.emit('update-strokes-after-undo', allStrokesMemory);
    });

    socket.on('disconnect', () => { delete activeUsers[socket.id]; });
});

// Sunucu buluta yüklendiğinde oradaki portu otomatik alır, yerelde ise 3000'i kullanır.
// Eski server.listen satırını tamamen sil ve bunu ekle:
// ... diğer kodların ...

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor!`);
});
// Mobil Dokunma Desteği
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Sayfa kaymasını engeller
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY,
        button: 0
    });
    canvas.dispatchEvent(mouseEvent);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault(); 
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    canvas.dispatchEvent(mouseEvent);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    const mouseEvent = new MouseEvent('mouseup', {});
    canvas.dispatchEvent(mouseEvent);
}, { passive: false });