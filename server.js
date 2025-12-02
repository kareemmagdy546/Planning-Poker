require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3002;
const ALLOWED_EMAIL_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || '';
const APP_PASSWORD = process.env.APP_PASSWORD || '';

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'planning-poker-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS
}));

// Single room state (only one room at a time)
let room = null;

// Room state structure:
// {
//   users: Map<socketId, { id: string, name: string, email: string, vote: string | null }>,
//   stories: Array<{ id: string, title: string, description: string }>,
//   currentStoryId: string | null,
//   votes: Map<userId, string>, // userId -> vote value
//   votesRevealed: boolean,
//   estimationStarted: boolean,
//   createdAt: Date
// }

// Initialize room if it doesn't exist
function getOrCreateRoom() {
  if (!room) {
    room = {
      users: new Map(),
      stories: [],
      currentStoryId: null,
      votes: new Map(),
      votesRevealed: false,
      estimationStarted: false,
      createdAt: new Date()
    };
  }
  return room;
}

// Validate email and extract name
function validateEmailAndExtractName(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }
  
  const emailLower = email.toLowerCase().trim();
  
  // If allowed domain is set, validate it
  if (ALLOWED_EMAIL_DOMAIN && ALLOWED_EMAIL_DOMAIN.trim() !== '') {
    const allowedDomain = `@${ALLOWED_EMAIL_DOMAIN.toLowerCase().trim()}`;
    
    if (!emailLower.endsWith(allowedDomain)) {
      return { valid: false, error: `Email must end with @${ALLOWED_EMAIL_DOMAIN}` };
    }
  }
  
  // Extract name from email (part before @)
  const namePart = emailLower.split('@')[0];
  if (!namePart) {
    return { valid: false, error: 'Invalid email format' };
  }
  
  // Capitalize first letter of name
  const name = namePart.split('.')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  
  return { valid: true, name, email: emailLower };
}

// Password validation helper
function validatePassword(password) {
  if (!APP_PASSWORD) {
    return true; // No password required
  }
  return password === APP_PASSWORD;
}

// Routes
app.get('/', (req, res) => {
  const error = req.query.error;
  const passwordError = req.query.passwordError;
  res.render('index', { 
    error, 
    passwordError,
    allowedEmailDomain: ALLOWED_EMAIL_DOMAIN,
    requiresPassword: !!APP_PASSWORD
  });
});

app.post('/room', (req, res) => {
  const { email, password } = req.body;
  
  // Validate email
  const validation = validateEmailAndExtractName(email);
  if (!validation.valid) {
    return res.redirect('/?error=' + encodeURIComponent(validation.error));
  }
  
  // Check password if required
  if (APP_PASSWORD) {
    if (!password || !validatePassword(password)) {
      return res.redirect('/?passwordError=Invalid password');
    }
  }
  
  // Store email in session
  req.session.userEmail = validation.email;
  req.session.authenticated = true;
  
  res.redirect('/room');
});

app.get('/room', (req, res) => {
  // Check if user is authenticated
  if (!req.session.authenticated || !req.session.userEmail) {
    return res.redirect('/?error=Please enter your email and password');
  }
  
  res.render('room', { 
    allowedEmailDomain: ALLOWED_EMAIL_DOMAIN,
    userEmail: req.session.userEmail 
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join the room (only one room exists)
  socket.on('join-room', (data) => {
    const { email } = data;
    
    // Password is already validated via HTTP session, no need to check here
    
    // Validate email
    const validation = validateEmailAndExtractName(email);
    if (!validation.valid) {
      socket.emit('error', { message: validation.error });
      return;
    }

    const currentRoom = getOrCreateRoom();
    
    // Check if user with this email already exists
    const existingUser = Array.from(currentRoom.users.values())
      .find(u => u.email === validation.email);
    
    if (existingUser) {
      socket.emit('error', { message: 'A user with this email is already in the room' });
      return;
    }

    const user = {
      id: socket.id,
      name: validation.name,
      email: validation.email,
      vote: null
    };

    currentRoom.users.set(socket.id, user);
    socket.join('main-room');

    // Send current room state to the new user
    socket.emit('room-state', {
      users: Array.from(currentRoom.users.values()),
      stories: currentRoom.stories,
      currentStoryId: currentRoom.currentStoryId,
      votes: currentRoom.votesRevealed ? Object.fromEntries(currentRoom.votes) : {},
      votesRevealed: currentRoom.votesRevealed,
      estimationStarted: currentRoom.estimationStarted
    });

    // Notify others in the room
    socket.to('main-room').emit('user-joined', {
      user: { id: user.id, name: user.name }
    });

    // Broadcast updated user list to EVERYONE (including the new user)
    // Use a small delay to ensure socket.join is complete
    setImmediate(() => {
      io.to('main-room').emit('users-updated', {
        users: Array.from(currentRoom.users.values())
      });
    });
  });

  // Leave room
  socket.on('leave-room', () => {
    const currentRoom = getOrCreateRoom();
    if (!currentRoom.users.has(socket.id)) return;

    currentRoom.users.delete(socket.id);
    currentRoom.votes.delete(socket.id);
    socket.leave('main-room');

    // Notify others
    socket.to('main-room').emit('user-left', { userId: socket.id });
    io.to('main-room').emit('users-updated', {
      users: Array.from(currentRoom.users.values())
    });
  });

  // Add story
  socket.on('add-story', (data) => {
    const { title, description } = data;
    const currentRoom = getOrCreateRoom();

    const story = {
      id: uuidv4(),
      title: title || 'Untitled Story',
      description: description || ''
    };

    currentRoom.stories.push(story);
    io.to('main-room').emit('story-added', { story });
  });

  // Set current story
  socket.on('set-current-story', (data) => {
    const { storyId } = data;
    const currentRoom = getOrCreateRoom();
    
    currentRoom.currentStoryId = storyId;
    currentRoom.votes.clear();
    currentRoom.votesRevealed = false;
    currentRoom.estimationStarted = false;

    // Update all users' vote status
    currentRoom.users.forEach((user) => {
      user.vote = null;
    });

    io.to('main-room').emit('current-story-changed', {
      storyId,
      story: currentRoom.stories.find(s => s.id === storyId)
    });
  });

  // Start estimation
  socket.on('start-estimation', () => {
    const currentRoom = getOrCreateRoom();
    if (!currentRoom.currentStoryId) return;
    
    currentRoom.estimationStarted = true;
    io.to('main-room').emit('estimation-started');
  });

  // Submit vote
  socket.on('vote', (data) => {
    const { vote } = data;
    const currentRoom = getOrCreateRoom();
    
    if (!currentRoom.users.has(socket.id)) return;

    const user = currentRoom.users.get(socket.id);
    user.vote = vote;
    currentRoom.votes.set(socket.id, vote);

    // Notify room that a vote was submitted (but don't reveal it)
    io.to('main-room').emit('vote-submitted', {
      userId: socket.id,
      userName: user.name
    });
  });

  // Reveal votes
  socket.on('reveal-votes', () => {
    const currentRoom = getOrCreateRoom();
    currentRoom.votesRevealed = true;

    // Create array of votes with user info
    const votesWithUsers = Array.from(currentRoom.votes.entries()).map(([userId, vote]) => {
      const user = currentRoom.users.get(userId);
      return {
        userId,
        userName: user ? user.name : 'Unknown',
        vote
      };
    });

    io.to('main-room').emit('votes-revealed', {
      votes: Object.fromEntries(currentRoom.votes),
      votesWithUsers,
      users: Array.from(currentRoom.users.values())
    });
  });

  // Reset votes for next round
  socket.on('reset-votes', () => {
    const currentRoom = getOrCreateRoom();
    currentRoom.votes.clear();
    currentRoom.votesRevealed = false;
    currentRoom.estimationStarted = false;

    currentRoom.users.forEach((user) => {
      user.vote = null;
    });

    io.to('main-room').emit('votes-reset');
  });

  // Restart voting (clear votes without revealing)
  socket.on('restart-voting', () => {
    const currentRoom = getOrCreateRoom();
    currentRoom.votes.clear();
    currentRoom.votesRevealed = false;
    currentRoom.estimationStarted = false;

    currentRoom.users.forEach((user) => {
      user.vote = null;
    });

    io.to('main-room').emit('votes-restarted');
  });

  // Delete story
  socket.on('delete-story', (data) => {
    const { storyId } = data;
    const currentRoom = getOrCreateRoom();
    
    const storyIndex = currentRoom.stories.findIndex(s => s.id === storyId);
    if (storyIndex === -1) return;
    
    currentRoom.stories.splice(storyIndex, 1);
    
    // If deleted story was current, clear current story
    if (currentRoom.currentStoryId === storyId) {
      currentRoom.currentStoryId = null;
      currentRoom.votes.clear();
      currentRoom.votesRevealed = false;
      currentRoom.estimationStarted = false;
      
      currentRoom.users.forEach((user) => {
        user.vote = null;
      });
    }
    
    io.to('main-room').emit('story-deleted', { storyId });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    const currentRoom = getOrCreateRoom();
    if (currentRoom.users.has(socket.id)) {
      currentRoom.users.delete(socket.id);
      currentRoom.votes.delete(socket.id);
      
      socket.to('main-room').emit('user-left', { userId: socket.id });
      io.to('main-room').emit('users-updated', {
        users: Array.from(currentRoom.users.values())
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Planning Poker server running on http://localhost:${PORT}`);
});

