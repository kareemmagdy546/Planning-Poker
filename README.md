# Planning Poker

A real-time planning poker application for sprint planning and story estimation. Built with Express.js and Socket.io for seamless team collaboration.

## Features

- Real-time multiplayer voting using WebSockets
- Email-based authentication (configurable domain restriction)
- 10-second countdown timer for voting sessions
- Individual vote display with names and statistics
- Story management with delete functionality
- Blue highlight for currently selected story

## Docker Deployment

### Build the Docker Image

```bash
docker build -t planning-poker .
```

### Run with Docker

```bash
docker run -d -p 3002:3002 --name planning-poker planning-poker
```

### Run with Docker Compose

```bash
docker-compose up -d
```

### Push to Docker Hub (Public Image)

1. Login to Docker Hub:
```bash
docker login
```

2. Tag your image (replace `yourusername` with your Docker Hub username):
```bash
docker tag planning-poker yourusername/planning-poker:latest
```

3. Push to Docker Hub:
```bash
docker push yourusername/planning-poker:latest
```

4. Make sure the repository is set to **Public** on Docker Hub.

### Pull and Run Public Image

Once pushed, others can run it with:
```bash
docker pull yourusername/planning-poker:latest
docker run -d -p 3002:3002 --name planning-poker yourusername/planning-poker:latest
```

## Local Development

### Prerequisites

- Node.js 18 or higher
- npm

### Installation

```bash
npm install
```

### Run

```bash
npm start
```

The application will be available at `http://localhost:3002`

### Development Mode

```bash
npm run dev
```

## Usage

1. Enter your email to join (domain restriction configurable via environment variable)
2. Add stories to estimate
3. Select a story to begin
4. Click "Start Estimation" to begin voting
5. Vote using planning poker cards
6. Reveal votes to see results
7. View statistics and individual votes

## Environment Variables

The following environment variables can be configured:

- `PORT` - Server port (default: 3002)
- `ALLOWED_EMAIL_DOMAIN` - Optional email domain restriction (e.g., `example.com`)
- `APP_PASSWORD` - Required password for accessing the room (leave empty to disable)
- `SESSION_SECRET` - Secret key for session encryption (required for session security)

### Setting Environment Variables

Create a `.env` file in the root directory:

```bash
PORT=3002
ALLOWED_EMAIL_DOMAIN=
APP_PASSWORD=your-secure-password
SESSION_SECRET=your-random-secret-key-here
```

**Important:** Generate a secure random string for `SESSION_SECRET`. You can generate one using:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Or use a password generator to create a 32+ character random string.

## Technology Stack

- **Backend**: Express.js with Socket.io
- **Frontend**: EJS templates with vanilla JavaScript
- **Real-time**: WebSocket communication via Socket.io

