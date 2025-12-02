// Get email from URL
const urlParams = new URLSearchParams(window.location.search);
const userEmail = urlParams.get('email');

// Initialize Socket.io
const socket = io();

let currentStoryId = null;
let votesRevealed = false;
let estimationStarted = false;
let users = [];
let stories = [];
let votes = {};
let voteTimer = null;
let timerSeconds = 10;

// Planning poker card values
const CARD_VALUES = ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?', '☕'];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (!userEmail) {
        alert('Email is required');
        window.location.href = '/';
        return;
    }
    
    // Validate email on client side (only if domain restriction is set)
    if (typeof ALLOWED_EMAIL_DOMAIN !== 'undefined' && ALLOWED_EMAIL_DOMAIN && ALLOWED_EMAIL_DOMAIN.trim() !== '') {
        const allowedDomain = '@' + ALLOWED_EMAIL_DOMAIN.toLowerCase().trim();
        if (!userEmail.toLowerCase().endsWith(allowedDomain)) {
            alert('Email must end with @' + ALLOWED_EMAIL_DOMAIN);
            window.location.href = '/';
            return;
        }
    }
    
    initializeUI();
    joinRoom();
});

// Socket event handlers
socket.on('room-state', (data) => {
    users = data.users || [];
    stories = data.stories || [];
    currentStoryId = data.currentStoryId;
    votes = data.votes || {};
    votesRevealed = data.votesRevealed || false;
    estimationStarted = data.estimationStarted || false;
    
    if (estimationStarted && !votesRevealed) {
        startVoteTimer();
    }
    
    updateUI();
});

socket.on('user-joined', (data) => {
    console.log('User joined:', data.user.name);
});

socket.on('user-left', (data) => {
    console.log('User left:', data.userId);
});

socket.on('users-updated', (data) => {
    users = data.users || [];
    updateUsersList();
});

socket.on('story-added', (data) => {
    stories.push(data.story);
    updateStoriesList();
});

socket.on('current-story-changed', (data) => {
    currentStoryId = data.storyId;
    votesRevealed = false;
    estimationStarted = false;
    votes = {};
    clearVoteTimer();
    updateStoriesList();
    updateCurrentStory(data.story);
    updateVotingSection();
});

socket.on('vote-submitted', (data) => {
    updateVotingStatus();
});

socket.on('votes-revealed', (data) => {
    votesRevealed = true;
    votes = data.votes || {};
    clearVoteTimer();
    // Update current story to show reset button instead of reveal button
    if (currentStoryId) {
        const story = stories.find(s => s.id === currentStoryId);
        if (story) {
            updateCurrentStory(story);
        }
    }
    showVoteResults(data.votesWithUsers || [], data.users);
    updateVotingSection();
});

socket.on('votes-reset', () => {
    votesRevealed = false;
    estimationStarted = false;
    votes = {};
    clearVoteTimer();
    // Update current story to show start button again
    if (currentStoryId) {
        const story = stories.find(s => s.id === currentStoryId);
        if (story) {
            updateCurrentStory(story);
        }
    }
    updateVotingSection();
    hideVoteResults();
});

socket.on('votes-restarted', () => {
    votesRevealed = false;
    estimationStarted = false;
    votes = {};
    clearVoteTimer();
    // Update current story to show start button again
    if (currentStoryId) {
        const story = stories.find(s => s.id === currentStoryId);
        if (story) {
            updateCurrentStory(story);
        }
    }
    updateVotingSection();
    hideVoteResults();
});

socket.on('estimation-started', () => {
    estimationStarted = true;
    startVoteTimer();
    // Update current story to show reveal button instead of start button
    if (currentStoryId) {
        const story = stories.find(s => s.id === currentStoryId);
        if (story) {
            updateCurrentStory(story);
        }
    }
    updateVotingSection();
});

socket.on('story-deleted', (data) => {
    stories = stories.filter(s => s.id !== data.storyId);
    if (currentStoryId === data.storyId) {
        currentStoryId = null;
        votesRevealed = false;
        estimationStarted = false;
        votes = {};
        clearVoteTimer();
    }
    updateStoriesList();
    updateCurrentStory(null);
    updateVotingSection();
});

socket.on('error', (data) => {
    alert(data.message);
    window.location.href = '/';
});

// UI Functions
function initializeUI() {
    // Create voting cards
    const voteCardsContainer = document.getElementById('vote-cards');
    voteCardsContainer.innerHTML = '';
    
    CARD_VALUES.forEach(value => {
        const card = document.createElement('button');
        card.className = 'vote-card';
        card.textContent = value;
        card.dataset.value = value;
        card.addEventListener('click', () => submitVote(value));
        voteCardsContainer.appendChild(card);
    });

    // Add story modal
    document.getElementById('add-story-btn').addEventListener('click', () => {
        document.getElementById('add-story-modal').style.display = 'flex';
    });

    document.getElementById('close-add-story').addEventListener('click', closeAddStoryModal);
    document.getElementById('cancel-add-story').addEventListener('click', closeAddStoryModal);

    document.getElementById('add-story-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const title = document.getElementById('story-title').value.trim();
        const description = document.getElementById('story-description').value.trim();
        
        if (title) {
            socket.emit('add-story', {
                title,
                description
            });
            document.getElementById('add-story-form').reset();
            closeAddStoryModal();
        }
    });

    // Leave room
    document.getElementById('leave-room').addEventListener('click', () => {
        if (confirm('Are you sure you want to leave the room?')) {
            clearVoteTimer();
            socket.emit('leave-room');
            window.location.href = '/';
        }
    });

    // Restart voting
    const restartVotingBtn = document.getElementById('restart-voting-btn');
    if (restartVotingBtn) {
        restartVotingBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to restart voting? All votes will be cleared.')) {
                socket.emit('restart-voting');
            }
        });
    }
}

function joinRoom() {
    socket.emit('join-room', {
        email: userEmail
    });
}

function submitVote(value) {
    if (!currentStoryId) return;
    
    socket.emit('vote', {
        vote: value
    });
    
    // Update UI immediately
    document.querySelectorAll('.vote-card').forEach(card => {
        card.classList.remove('selected');
        if (card.dataset.value === value) {
            card.classList.add('selected');
        }
    });
}

function updateUI() {
    updateUsersList();
    updateStoriesList();
    
    if (currentStoryId) {
        const story = stories.find(s => s.id === currentStoryId);
        if (story) {
            updateCurrentStory(story);
        }
    } else {
        updateCurrentStory(null);
    }
    
    updateVotingSection();
}

function updateUsersList() {
    const usersList = document.getElementById('users-list');
    const userCount = document.getElementById('user-count');
    
    userCount.textContent = users.length;
    usersList.innerHTML = '';
    
    users.forEach(user => {
        const userEl = document.createElement('div');
        userEl.className = 'user-item';
        userEl.innerHTML = `
            <span class="user-name">${escapeHtml(user.name)}</span>
            <span class="user-vote-status">
                ${user.vote !== null ? (votesRevealed ? `<span class="vote-badge">${escapeHtml(user.vote)}</span>` : '✓') : '⏳'}
            </span>
        `;
        usersList.appendChild(userEl);
    });
}

function updateStoriesList() {
    const storiesList = document.getElementById('stories-list');
    storiesList.innerHTML = '';
    
    if (stories.length === 0) {
        storiesList.innerHTML = '<p class="empty-state">No stories yet. Add one to get started!</p>';
        return;
    }
    
    stories.forEach(story => {
        const storyEl = document.createElement('div');
        storyEl.className = `story-item ${story.id === currentStoryId ? 'active' : ''}`;
        storyEl.innerHTML = `
            <div class="story-item-content">
                <h4>${escapeHtml(story.title)}</h4>
                ${story.description ? `<p>${escapeHtml(story.description)}</p>` : ''}
            </div>
            <button class="btn btn-small set-current-story" data-story-id="${story.id}">
                ${story.id === currentStoryId ? 'Current' : 'Select'}
            </button>
        `;
        
        storyEl.querySelector('.set-current-story').addEventListener('click', () => {
            socket.emit('set-current-story', {
                storyId: story.id
            });
        });
        
        storiesList.appendChild(storyEl);
    });
}

function updateCurrentStory(story) {
    const currentStoryEl = document.getElementById('current-story');
    
    if (!story) {
        currentStoryEl.innerHTML = '<p class="no-story">No story selected. Add a story to begin estimating.</p>';
        return;
    }
    
    currentStoryEl.innerHTML = `
        <div class="story-header">
            <h3>${escapeHtml(story.title)}</h3>
            <button class="btn-icon btn-delete-story" id="delete-story-btn" title="Delete story">🗑️</button>
        </div>
        ${story.description ? `<p>${escapeHtml(story.description)}</p>` : ''}
        <div class="story-actions">
            ${!estimationStarted ? `
                <button class="btn btn-primary" id="start-estimation-btn">Start Estimation</button>
            ` : votesRevealed ? `
                <button class="btn btn-primary" id="reset-votes-btn">Reset Votes</button>
            ` : `
                <button class="btn btn-primary" id="reveal-votes-btn">Reveal Votes</button>
            `}
        </div>
    `;
    
    // Add event listeners
    const startEstimationBtn = document.getElementById('start-estimation-btn');
    const revealBtn = document.getElementById('reveal-votes-btn');
    const resetBtn = document.getElementById('reset-votes-btn');
    const deleteStoryBtn = document.getElementById('delete-story-btn');
    
    if (startEstimationBtn) {
        startEstimationBtn.addEventListener('click', () => {
            socket.emit('start-estimation');
        });
    }
    
    if (revealBtn) {
        revealBtn.addEventListener('click', () => {
            socket.emit('reveal-votes');
        });
    }
    
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            socket.emit('reset-votes');
        });
    }
    
    if (deleteStoryBtn) {
        deleteStoryBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to delete this story?')) {
                socket.emit('delete-story', { storyId: story.id });
            }
        });
    }
}

function updateVotingSection() {
    const voteStatusText = document.getElementById('vote-status-text');
    const voteCards = document.querySelectorAll('.vote-card');
    const votingActions = document.getElementById('voting-actions');
    const timerElement = document.getElementById('vote-timer');
    
    if (!currentStoryId) {
        voteStatusText.textContent = 'Waiting for story...';
        if (timerElement) timerElement.style.display = 'none';
        if (votingActions) votingActions.style.display = 'none';
        voteCards.forEach(card => {
            card.disabled = true;
            card.classList.remove('selected');
        });
        return;
    }
    
    if (!estimationStarted) {
        voteStatusText.textContent = 'Click "Start Estimation" to begin voting';
        if (timerElement) timerElement.style.display = 'none';
        if (votingActions) votingActions.style.display = 'none';
        voteCards.forEach(card => {
            card.disabled = true;
            card.classList.remove('selected');
        });
        return;
    }
    
    if (votesRevealed) {
        voteStatusText.textContent = 'Votes revealed!';
        if (timerElement) timerElement.style.display = 'none';
        if (votingActions) votingActions.style.display = 'none';
        voteCards.forEach(card => {
            card.disabled = true;
        });
    } else {
        const myVote = votes[socket.id];
        voteStatusText.textContent = myVote ? `You voted: ${myVote}` : 'Select your estimate';
        if (timerElement) timerElement.style.display = 'block';
        if (votingActions) votingActions.style.display = 'block';
        voteCards.forEach(card => {
            card.disabled = false;
            card.classList.toggle('selected', card.dataset.value === myVote);
        });
    }
}

function startVoteTimer() {
    if (!currentStoryId || votesRevealed) return;
    
    clearVoteTimer();
    timerSeconds = 10;
    updateTimerDisplay();
    
    voteTimer = setInterval(() => {
        timerSeconds--;
        updateTimerDisplay();
        
        if (timerSeconds <= 0) {
            clearVoteTimer();
            // Timer expired - could auto-reveal or just stop
            // For now, just stop the timer
        }
    }, 1000);
}

function clearVoteTimer() {
    if (voteTimer) {
        clearInterval(voteTimer);
        voteTimer = null;
    }
    timerSeconds = 10;
    updateTimerDisplay();
}

function updateTimerDisplay() {
    const timerCountdown = document.getElementById('timer-countdown');
    if (timerCountdown) {
        timerCountdown.textContent = timerSeconds;
        
        // Add visual warning when time is running out
        const timerElement = document.getElementById('vote-timer');
        if (timerElement) {
            if (timerSeconds <= 3) {
                timerElement.classList.add('timer-warning');
            } else {
                timerElement.classList.remove('timer-warning');
            }
        }
    }
}

function showVoteResults(votesWithUsers, userList) {
    const voteResult = document.getElementById('vote-result');
    voteResult.style.display = 'block';
    
    if (!votesWithUsers || votesWithUsers.length === 0) {
        voteResult.innerHTML = `
            <h3>Vote Results</h3>
            <p>No votes submitted yet.</p>
        `;
        return;
    }
    
    // Calculate statistics from numeric votes only
    const numericVotes = votesWithUsers
        .map(v => v.vote)
        .filter(v => v !== '?' && v !== '☕')
        .map(v => parseInt(v))
        .filter(v => !isNaN(v));
    
    let statsHtml = '';
    if (numericVotes.length > 0) {
        const avg = numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length;
        const min = Math.min(...numericVotes);
        const max = Math.max(...numericVotes);
        statsHtml = `
            <div class="vote-stats">
                <div class="stat">
                    <span class="stat-label">Average:</span>
                    <span class="stat-value">${avg.toFixed(1)}</span>
                </div>
                <div class="stat">
                    <span class="stat-label">Min:</span>
                    <span class="stat-value">${min}</span>
                </div>
                <div class="stat">
                    <span class="stat-label">Max:</span>
                    <span class="stat-value">${max}</span>
                </div>
            </div>
        `;
    }
    
    // Show individual votes with names
    const individualVotesHtml = votesWithUsers.map(voteData => `
        <div class="vote-with-name">
            <span class="vote-name">${escapeHtml(voteData.userName)}</span>
            <span class="vote-value-badge">${escapeHtml(voteData.vote)}</span>
        </div>
    `).join('');
    
    voteResult.innerHTML = `
        <h3>Vote Results</h3>
        ${statsHtml}
        <div class="individual-votes">
            <h4>Individual Votes</h4>
            <div class="votes-list">
                ${individualVotesHtml}
            </div>
        </div>
    `;
}

function hideVoteResults() {
    document.getElementById('vote-result').style.display = 'none';
}

function updateVotingStatus() {
    const votedCount = Object.keys(votes).length;
    const totalUsers = users.length;
    
    if (votedCount > 0 && !votesRevealed) {
        document.getElementById('vote-status-text').textContent = 
            `${votedCount} of ${totalUsers} participants have voted`;
    }
}

function closeAddStoryModal() {
    document.getElementById('add-story-modal').style.display = 'none';
    document.getElementById('add-story-form').reset();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Handle page unload
window.addEventListener('beforeunload', () => {
    clearVoteTimer();
    socket.emit('leave-room');
});

