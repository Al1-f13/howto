const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const players = [
  {
    x: 100,
    y: 100,
    size: 50,
    color: '#ff0000'
  },
  {
    x: 600,
    y: 100,
    size: 50,
    color: '#00ff00'
  }
];

const ball = {
  x: 300,
  y: 300,
  size: 50,
  color: '#ffffff'
};

let phase = '';
let last = 0;
let clockT = 0;

function frame() {
  // Update time
  clockT += 16;

  // Update players
  for (const player of players) {
    player.x += player.vx;
    player.y += player.vy;

    // Boundaries
    if (player.x < 100 || player.x > 600) {
      player.vx = -player.vx;
    }
    if (player.y < 100 || player.y > 600) {
      player.vy = -player.vy;
    }
  }

  // Update ball
  ball.x += ball.vx;
  ball.y += ball.vy;

  // Boundaries
  if (ball.x < 300 || ball.x > 600) {
    ball.vx = -ball.vx;
  }
  if (ball.y < 300 || ball.y > 600) {
    ball.vy = -ball.vy;
  }

  // Render
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const player of players) {
    ctx.fillStyle = player.color;
    ctx.fillRect(player.x, player.y, player.size, player.size);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(ball.x, ball.y, ball.size, ball.size);
}

function update() {
  // Update time
  clockT += 16;

  // Update players
  for (const player of players) {
    player.last = clockT;
    player.x += player.vx;
    player.y += player.vy;

    // Boundaries
    if (player.x < 100 || player.x > 600) {
      player.vx = -player.vx;
    }
    if (player.y < 100 || player.y > 600) {
      player.vy = -player.vy;
    }
  }

  // Update ball
  ball.x += ball.vx;
  ball.y += ball.vy;

  // Boundaries
  if (ball.x < 300 || ball.x > 600) {
    ball.vx = -ball.vx;
  }
  if (ball.y < 300 || ball.y > 600) {
    ball.vy = -ball.vy;
  }

  // Check for goals
  for (const player of players) {
    if (player.x < ball.x + ball.size && player.y < ball.y + ball.size && player.x > ball.x - ball.size &&
player.y > ball.y - ball.size) {
      console.log('Goal!');
      return;
    }
  }
}

function showOverlay() {
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.background = '#000000';
  overlay.style.color = '#ffffff';
  overlay.style.fontSize = '24px';
  overlay.style.fontWeight = 'bold';
  overlay.innerHTML = `Score: ${players[0].score} - ${players[1].score}`;
  document.body.appendChild(overlay);
}

function resetGame() {
  phase = '';
  last = 0;
  clockT = 0;
  players = [
    {
      x: 100,
      y: 100,
      size: 50,
      color: '#ff0000'
    },
    {
      x: 600,
      y: 100,
      size: 50,
      color: '#00ff00'
    }
  ];
  ball = {
    x: 300,
    y: 300,
    size: 50,
    color: '#ffffff'
  };
}

frame();
showOverlay();