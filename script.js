/* ==========================================================
   CLASSIC SNAKE — pure client-side JavaScript
   ----------------------------------------------------------
   How the game is organised:
     1. CONFIG & STATE   – constants and the variables that describe the game
     2. SETUP            – reset everything for a new game
     3. GAME LOOP        – a fixed-speed "tick" driven by requestAnimationFrame
     4. UPDATE           – snake movement, eating food, collision detection
     5. RENDER           – drawing the board, snake and food on the canvas
     6. INPUT            – keyboard (Arrows / WASD) and touch swipes
   ========================================================== */

(() => {
  "use strict";

  /* ---------------------------------------------------------
     1. CONFIG & STATE
     --------------------------------------------------------- */
  const GRID = 20;              // board is GRID x GRID cells
  const START_SPEED = 8;        // ticks (moves) per second at the start
  const MAX_SPEED = 18;         // speed cap
  const SPEED_STEP = 0.35;      // how much faster per food eaten

  // Direction vectors. x grows to the right, y grows downward (canvas coordinates).
  const DIRS = {
    up:    { x: 0,  y: -1 },
    down:  { x: 0,  y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1,  y: 0 },
  };

  // Map keyboard keys to directions (both arrow keys and WASD).
  const KEY_MAP = {
    ArrowUp: "up",    w: "up",    W: "up",
    ArrowDown: "down", s: "down", S: "down",
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right",
  };

  // DOM references
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const finalScoreEl = document.getElementById("final-score");
  const newBestEl = document.getElementById("new-best");
  const startScreen = document.getElementById("start-screen");
  const pauseScreen = document.getElementById("pause-screen");
  const gameOverScreen = document.getElementById("gameover-screen");
  const startBtn = document.getElementById("start-btn");
  const restartBtn = document.getElementById("restart-btn");

  // Mutable game state
  let snake;          // array of {x, y}; snake[0] is the HEAD
  let direction;      // direction the snake is currently moving
  let inputQueue;     // buffered direction changes (lets quick key presses register)
  let food;           // {x, y} position of the food
  let score;
  let speed;          // current ticks per second
  let state = "ready"; // "ready" | "running" | "paused" | "over"

  // Timing for the game loop
  let lastTime = 0;
  let accumulator = 0;
  let rafId = null;

  // Best score is saved in the browser (localStorage). Wrapped in try/catch
  // because storage can be blocked in private windows or strict browsers.
  let best = 0;
  try {
    best = parseInt(localStorage.getItem("snake-best"), 10) || 0;
  } catch (_) { /* storage unavailable — best score just won't persist */ }
  bestEl.textContent = best;

  /* ---------------------------------------------------------
     2. SETUP
     --------------------------------------------------------- */
  function resetGame() {
    // Start with a 3-segment snake in the middle, heading right.
    const mid = Math.floor(GRID / 2);
    snake = [
      { x: mid,     y: mid },
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid },
    ];
    direction = DIRS.right;
    inputQueue = [];
    score = 0;
    speed = START_SPEED;
    scoreEl.textContent = score;
    placeFood();
  }

  // Put food on a random cell that is NOT occupied by the snake.
  function placeFood() {
    const free = [];
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (!snake.some(s => s.x === x && s.y === y)) free.push({ x, y });
      }
    }
    // If there are no free cells the player has filled the board — they win!
    food = free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }

  function startGame() {
    resetGame();
    showOverlay(null);
    state = "running";
    lastTime = performance.now();
    accumulator = 0;
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  /* ---------------------------------------------------------
     3. GAME LOOP
     ---------------------------------------------------------
     requestAnimationFrame calls loop() ~60 times a second (matching
     the screen refresh). But we don't want the snake to move 60 cells
     a second! So we use a "fixed timestep":

       - Each frame, add the elapsed time to an `accumulator`.
       - While the accumulator holds at least one tick's worth of time
         (1000ms / speed), run one update() and subtract that tick.
       - Always render() so the screen stays fresh.

     This keeps the snake moving at the same speed on 60Hz, 120Hz or
     144Hz monitors, and catches up smoothly if a frame is late.
     --------------------------------------------------------- */
  function loop(now) {
    rafId = requestAnimationFrame(loop);

    const delta = now - lastTime;
    lastTime = now;

    if (state === "running") {
      // Clamp delta so a long pause (e.g. switching tabs) doesn't cause a burst of moves.
      accumulator += Math.min(delta, 250);
      const tickLength = 1000 / speed;

      while (accumulator >= tickLength && state === "running") {
        update();
        accumulator -= tickLength;
      }
    }

    render();
  }

  /* ---------------------------------------------------------
     4. UPDATE — one "tick" of game logic
     --------------------------------------------------------- */
  function update() {
    // --- Apply the next buffered direction (if any) ---
    // We take ONE queued input per tick. This stops a fast "up then left"
    // from being lost, and stops the snake reversing into itself.
    if (inputQueue.length) direction = inputQueue.shift();

    // --- SNAKE MOVEMENT ---
    // The snake moves by adding a new head one cell in the current
    // direction, then (usually) removing the tail. The body segments
    // never move individually — it's just "add to front, drop from back".
    const head = snake[0];
    const newHead = { x: head.x + direction.x, y: head.y + direction.y };

    // --- COLLISION DETECTION ---
    // 1) Wall collision: the new head is outside the grid.
    const hitWall =
      newHead.x < 0 || newHead.x >= GRID ||
      newHead.y < 0 || newHead.y >= GRID;

    // 2) Self collision: the new head lands on a body segment.
    //    We ignore the last tail segment because it will move out of the way
    //    this same tick (unless we're eating, in which case it stays).
    const willEat = food && newHead.x === food.x && newHead.y === food.y;
    const bodyToCheck = willEat ? snake : snake.slice(0, -1);
    const hitSelf = bodyToCheck.some(s => s.x === newHead.x && s.y === newHead.y);

    if (hitWall || hitSelf) {
      gameOver();
      return;
    }

    // Move: add the new head at the front.
    snake.unshift(newHead);

    if (willEat) {
      // --- EATING ---
      // Don't remove the tail, so the snake grows by one segment.
      score++;
      scoreEl.textContent = score;
      speed = Math.min(MAX_SPEED, speed + SPEED_STEP);
      placeFood();
      if (!food) gameOver(); // board filled — game complete
    } else {
      // Normal move: drop the tail so the length stays the same.
      snake.pop();
    }
  }

  function gameOver() {
    state = "over";
    finalScoreEl.textContent = score;

    const isNewBest = score > best;
    newBestEl.hidden = !isNewBest;
    if (isNewBest) {
      best = score;
      bestEl.textContent = best;
      try { localStorage.setItem("snake-best", String(best)); } catch (_) {}
    }

    showOverlay(gameOverScreen);
    restartBtn.focus();
  }

  /* ---------------------------------------------------------
     5. RENDER — draw the current state onto the canvas
     --------------------------------------------------------- */

  // Keep the canvas sharp on any screen size / pixel density.
  // The canvas is sized by CSS; here we match its internal resolution to that.
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    // Scale drawing so 1 unit = 1 CSS pixel.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function render() {
    const size = canvas.getBoundingClientRect().width;
    const cell = size / GRID;
    const css = getComputedStyle(document.documentElement);

    // Background
    ctx.fillStyle = css.getPropertyValue("--board").trim();
    ctx.fillRect(0, 0, size, size);

    // Subtle checkerboard so players can judge distances
    ctx.fillStyle = css.getPropertyValue("--grid").trim();
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if ((x + y) % 2 === 0) ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    if (!snake) return;

    // Food — a glowing circle
    if (food) {
      const cx = food.x * cell + cell / 2;
      const cy = food.y * cell + cell / 2;
      ctx.save();
      ctx.shadowColor = "#f43f5e";
      ctx.shadowBlur = cell * 0.8;
      ctx.fillStyle = css.getPropertyValue("--food").trim();
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Snake — rounded squares, fading slightly from head to tail
    const pad = cell * 0.08;
    snake.forEach((seg, i) => {
      const t = i / Math.max(1, snake.length - 1);  // 0 at head → 1 at tail
      const lightness = 55 - t * 15;
      ctx.fillStyle = i === 0 ? "#4ade80" : `hsl(142, 70%, ${lightness}%)`;
      roundRect(seg.x * cell + pad, seg.y * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.25);
    });

    // Eyes on the head, pointing in the direction of travel
    const h = snake[0];
    const hx = h.x * cell + cell / 2;
    const hy = h.y * cell + cell / 2;
    const off = cell * 0.18;
    const eyeR = cell * 0.08;
    // Perpendicular to direction for eye spacing
    const px = -direction.y, py = direction.x;
    ctx.fillStyle = "#052e16";
    [1, -1].forEach(side => {
      ctx.beginPath();
      ctx.arc(
        hx + direction.x * off + px * off * side,
        hy + direction.y * off + py * off * side,
        eyeR, 0, Math.PI * 2
      );
      ctx.fill();
    });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  /* ---------------------------------------------------------
     Overlay helpers
     --------------------------------------------------------- */
  function showOverlay(which) {
    [startScreen, pauseScreen, gameOverScreen].forEach(el =>
      el.classList.toggle("visible", el === which)
    );
  }

  function togglePause() {
    if (state === "running") {
      state = "paused";
      showOverlay(pauseScreen);
    } else if (state === "paused") {
      state = "running";
      lastTime = performance.now(); // don't count the paused time
      showOverlay(null);
    }
  }

  /* ---------------------------------------------------------
     6. INPUT
     --------------------------------------------------------- */

  // Queue a direction change, rejecting reversals and duplicates.
  function queueDirection(name) {
    if (state !== "running") return;
    const next = DIRS[name];
    // Compare against the LAST queued direction (or the current one)
    const last = inputQueue.length ? inputQueue[inputQueue.length - 1] : direction;
    const isReverse = next.x === -last.x && next.y === -last.y;
    const isSame = next.x === last.x && next.y === last.y;
    if (!isReverse && !isSame && inputQueue.length < 3) inputQueue.push(next);
  }

  document.addEventListener("keydown", e => {
    const dirName = KEY_MAP[e.key];

    if (dirName) {
      e.preventDefault(); // stop arrow keys scrolling the page
      if (state === "ready") startGame();
      queueDirection(dirName);
      return;
    }

    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      if (state === "ready") startGame();
      else togglePause();
      return;
    }

    if (e.key === "Enter" && (state === "over" || state === "ready")) {
      e.preventDefault();
      startGame();
    }
  });

  // Touch: swipe on the board to steer
  let touchStart = null;
  canvas.addEventListener("touchstart", e => {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });

  canvas.addEventListener("touchend", e => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return; // ignore taps
    queueDirection(Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? "right" : "left")
      : (dy > 0 ? "down" : "up"));
  }, { passive: true });

  // Pause automatically if the player switches tabs
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "running") togglePause();
  });

  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);
  window.addEventListener("resize", () => { resizeCanvas(); render(); });

  /* ---------------------------------------------------------
     Initial draw (empty board behind the start screen)
     --------------------------------------------------------- */
  resetGame();
  resizeCanvas();
  render();
})();
