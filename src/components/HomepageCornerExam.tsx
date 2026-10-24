"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSession } from "@/lib/session";

const SUBJECTS = ["國文", "英文", "數A", "數B", "社會", "自然"] as const;
type Subject = (typeof SUBJECTS)[number];
type SubjectScores = Record<Subject, number>;

type FallingPaper = {
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  subject: Subject;
};

type PenProjectile = {
  active: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  angle: number;
  spinSpeed: number;
  hitsThisShot: number;
  resolved: boolean;
};

type Celebration = {
  text: string;
  ttlMs: number;
  durationMs: number;
};

type RuntimeState = {
  running: boolean;
  width: number;
  height: number;
  elapsedMs: number;
  papers: FallingPaper[];
  spawnAccumulator: number;
  selectedSubjects: Subject[];
  scores: SubjectScores;
  playerY: number;
  moveUp: boolean;
  moveDown: boolean;
  projectile: PenProjectile;
  celebration: Celebration | null;
};

type GamePhase = "select" | "playing" | "finished";
type FinishReason = "full" | "pens";

const CONFIG = {
  // 可調參數區：每局筆的數量（未命中一次扣一支）
  startingPens: 5,
  // 可調參數區：每科最高級分
  maxScorePerSubject: 15,
  // 可調參數區：考卷基礎掉落速度（像素/秒）
  paperBaseFallSpeed: 150,
  // 可調參數區：考卷隨時間增加掉落速度（像素/秒）
  paperTimeRampSpeed: 16,
  // 可調參數區：考卷隨分數增加掉落速度（像素/秒）
  paperScoreRampSpeed: 4,
  // 可調參數區：考卷生成基礎間隔（秒）
  paperSpawnBaseInterval: 1.4,
  // 可調參數區：考卷最小生成間隔（秒）
  paperSpawnMinInterval: 0.3,
  // 可調參數區：考卷生成隨時間加速係數（秒）
  paperSpawnTimeRamp: 0.028,
  // 可調參數區：考卷生成隨總分加速係數（秒）
  paperSpawnScoreRamp: 0.011,
  // 可調參數區：考卷像素尺寸
  paperWidth: 58,
  paperHeight: 74,
  // 可調參數區：筆上下移動速度（像素/秒）
  moveSpeed: 290,
  // 可調參數區：筆飛行速度（像素/秒）
  projectileSpeed: 490,
  // 可調參數區：筆旋轉速度（弧度/秒）
  projectileSpinSpeed: 8.4,
  // 可調參數區：多連擊成語顯示時間（毫秒）
  celebrationDurationMs: 1600,
  // 可調參數區：右側筆活動區寬度比例
  playerZoneRatio: 0.2,
  // 可調參數區：左側考卷掉落區寬度比例
  paperZoneRatio: 0.5,
  // 可調參數區：考卷掉落速度等級範圍（1 最慢、10 最快，每張隨機）
  paperSpeedLevelMin: 1,
  paperSpeedLevelMax: 10,
  // 可調參數區：最高達成率 localStorage 鍵名
  bestRateKey: "campus-toolkit-exam-best-rate",
};

function createEmptyScores(): SubjectScores {
  return Object.fromEntries(SUBJECTS.map((subject) => [subject, 0])) as SubjectScores;
}

function totalScoreOf(scores: SubjectScores, subjects: Subject[]): number {
  return subjects.reduce((sum, subject) => sum + (scores[subject] || 0), 0);
}

function maxScoreOf(subjects: Subject[]): number {
  return subjects.length * CONFIG.maxScorePerSubject;
}

function rateOf(scores: SubjectScores, subjects: Subject[]): number {
  const max = maxScoreOf(subjects);
  if (max <= 0) return 0;
  return Math.round((totalScoreOf(scores, subjects) / max) * 100);
}

function loadBestRate(): number | null {
  try {
    const raw = window.localStorage.getItem(CONFIG.bestRateKey);
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  } catch {
    return null;
  }
}

function saveBestRate(value: number): void {
  try {
    window.localStorage.setItem(CONFIG.bestRateKey, String(value));
  } catch {
    // 忽略寫入失敗
  }
}

type LeaderboardRow = {
  rank: number;
  name: string;
  role: string;
  roleLabel: string;
  score: number;
  recordDate: string;
};

type LeaderboardMy = {
  name: string;
  role: string;
  roleLabel: string;
  score: number;
  rank: number | null;
  recordDate: string;
};

async function loadRemoteBestRate(): Promise<number | null> {
  try {
    const res = await fetch("/api/exam-leaderboard", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.success && data.my && typeof data.my.score === "number") return data.my.score;
    return null;
  } catch {
    return null;
  }
}

async function saveRemoteBestRate(rate: number): Promise<boolean> {
  try {
    const res = await fetch("/api/exam-leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score: rate }),
    });
    return res.ok;
  } catch (error) {
    console.error("同步學測排行榜失敗:", error);
    return false;
  }
}

async function loadLeaderboard(): Promise<{ top: LeaderboardRow[]; my: LeaderboardMy | null } | null> {
  try {
    const res = await fetch("/api/exam-leaderboard", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success) return null;
    return { top: data.top ?? [], my: data.my ?? null };
  } catch {
    return null;
  }
}

function createHitContext(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    return new Ctor();
  } catch {
    return null;
  }
}

function playHit(audioCtx: AudioContext | null): void {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }

  const now = audioCtx.currentTime;
  const master = audioCtx.createGain();
  master.gain.setValueAtTime(0.25, now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  master.connect(audioCtx.destination);

  const partials = [880, 1320, 1760];
  partials.forEach((freq, index) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = index === 0 ? "triangle" : "sine";
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.7 / (index + 1), now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16 - index * 0.02);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.18);
  });
}

// 單支筆一次命中多份試卷時顯示的成語（同數量有多句時亂數取一句）
const CELEBRATION_IDIOMS: Record<number, readonly string[]> = {
  2: ["融會貫通", "觸類旁通", "左右逢源"],
  3: ["妙筆生花", "下筆成章"],
  4: ["信手拈來", "文思泉湧"],
  5: ["一揮而就", "滿腹經綸"],
};
const CELEBRATION_MAX_HIT = 6;

function pickCelebration(hits: number): string {
  if (hits >= CELEBRATION_MAX_HIT) return "無敵鐵金剛";
  const pool = CELEBRATION_IDIOMS[hits];
  if (!pool || pool.length === 0) return "";
  return pool[Math.floor(Math.random() * pool.length)];
}

const PAPER_SVG_D = "M4 2h16l8 8v28H4zM20 2v8h8";
const PEN_SVG_D =
  "M3 17.5l1.8-5.3 9.4-9.4 3.5 3.5-9.4 9.4-5.3 1.8zM12 5l3.5 3.5M4.8 12.2l3.5 3.5";

function drawPaper(ctx: CanvasRenderingContext2D, paper: FallingPaper) {
  if (typeof Path2D === "undefined") return;
  const path = new Path2D(PAPER_SVG_D);
  const scaleX = paper.width / 32;
  const scaleY = paper.height / 40;

  ctx.save();
  ctx.translate(paper.x, paper.y);
  ctx.scale(scaleX, scaleY);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.fill(path);
  ctx.stroke(path);
  ctx.restore();

  ctx.fillStyle = "#111111";
  ctx.font = `bold ${Math.max(12, Math.round(paper.height * 0.22))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(paper.subject, paper.x + paper.width / 2, paper.y + paper.height * 0.6);
}

function drawPen(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  if (typeof Path2D === "undefined") return;
  const path = new Path2D(PEN_SVG_D);
  const scale = Math.min(width / 24, height / 24);

  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate(Math.PI / 4);
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 1.1;
  ctx.lineJoin = "round";
  ctx.lineCap = "butt";
  ctx.fill(path);
  ctx.stroke(path);
  ctx.restore();
}

function createRuntime(width: number, height: number, selectedSubjects: Subject[]): RuntimeState {
  return {
    running: false,
    width,
    height,
    elapsedMs: 0,
    papers: [],
    spawnAccumulator: 0,
    selectedSubjects: [...selectedSubjects],
    scores: createEmptyScores(),
    playerY: Math.round(height * 0.5),
    moveUp: false,
    moveDown: false,
    projectile: {
      active: false,
      x: 0,
      y: 0,
      width: 96,
      height: 60,
      speed: CONFIG.projectileSpeed,
      angle: 0,
      spinSpeed: 0,
      hitsThisShot: 0,
      resolved: false,
    },
    celebration: null,
  };
}

function intersects(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export default function HomepageCornerExam({
  hideLauncher = false,
  openSignal = 0,
  launcherTop,
}: {
  /** 不顯示左上角浮動按鈕（改由外部卡片開啟） */
  hideLauncher?: boolean;
  /** 外部開啟訊號：數值遞增即開啟遊戲視窗 */
  openSignal?: number;
  /** 浮動按鈕的上緣位置（px）；未指定時沿用預設值 */
  launcherTop?: number;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<GamePhase>("select");
  const [selectedSubjects, setSelectedSubjects] = useState<Subject[]>([]);
  const [startedSubjects, setStartedSubjects] = useState<Subject[]>([]);
  const [subjectScores, setSubjectScores] = useState<SubjectScores>(createEmptyScores);
  const [pensLeft, setPensLeft] = useState(CONFIG.startingPens);
  const [finishReason, setFinishReason] = useState<FinishReason | null>(null);
  const [bestRate, setBestRate] = useState<number | null>(null);
  const [remoteBestRate, setRemoteBestRate] = useState<number | null>(null);
  const [showBoard, setShowBoard] = useState(false);
  const [boardRows, setBoardRows] = useState<LeaderboardRow[]>([]);
  const [boardMy, setBoardMy] = useState<LeaderboardMy | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [playerName, setPlayerName] = useState("匿名");
  const [playerRanked, setPlayerRanked] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const scoreRef = useRef<SubjectScores>(createEmptyScores());
  const pensRef = useRef(CONFIG.startingPens);
  const runtimeRef = useRef<RuntimeState>(createRuntime(960, 540, []));
  const phaseRef = useRef<GamePhase>("select");
  const prevTsRef = useRef(0);
  const bodyOverflowRef = useRef("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const bestRateRef = useRef<number | null>(null);
  const remoteBestRateRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerDraggedRef = useRef(false);
  const finishedRateRef = useRef<number | null>(null);
  const loggedInRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const syncedRateRef = useRef<number | null>(null);

  // 外部卡片開啟：訊號遞增即開啟遊戲視窗
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

  const closeOverlay = useCallback(() => {
    setOpen(false);
    setShowBoard(false);
  }, []);

  const refreshLeaderboard = useCallback(async () => {
    setBoardLoading(true);
    const data = await loadLeaderboard();
    if (data) {
      setBoardRows(data.top);
      setBoardMy(data.my);
    }
    setBoardLoading(false);
  }, []);

  const toggleLeaderboard = useCallback(() => {
    const next = !showBoard;
    setShowBoard(next);
    if (next) void refreshLeaderboard();
  }, [refreshLeaderboard, showBoard]);

  const syncRemoteBest = useCallback(async (currentRate: number): Promise<boolean> => {
    const ok = await saveRemoteBestRate(currentRate);
    if (ok) {
      const prev = remoteBestRateRef.current;
      if (prev === null || currentRate > prev) {
        remoteBestRateRef.current = currentRate;
        setRemoteBestRate(currentRate);
      }
    }
    return ok;
  }, []);

  const commitBestRate = useCallback((currentRate: number) => {
    const previousBest = bestRateRef.current;
    const improved = previousBest === null || currentRate > previousBest;
    if (improved) {
      bestRateRef.current = currentRate;
      setBestRate(currentRate);
      saveBestRate(currentRate);
    }

    if (!loggedInRef.current || !sessionReadyRef.current) return;
    if (currentRate <= 0) return;
    if (syncedRateRef.current !== null && currentRate <= syncedRateRef.current) return;
    syncedRateRef.current = currentRate;
    void syncRemoteBest(currentRate);
  }, [syncRemoteBest]);

  const prepareForSelection = useCallback(() => {
    runtimeRef.current = createRuntime(960, 540, []);
    phaseRef.current = "select";
    setPhase("select");
    setSelectedSubjects([]);
    setStartedSubjects([]);
    scoreRef.current = createEmptyScores();
    setSubjectScores(createEmptyScores());
    pensRef.current = CONFIG.startingPens;
    setPensLeft(CONFIG.startingPens);
    setFinishReason(null);
    finishedRateRef.current = null;
    prevTsRef.current = 0;
  }, []);

  const startGame = useCallback((subjects: Subject[]) => {
    if (subjects.length === 0) return;
    const ordered = SUBJECTS.filter((subject) => subjects.includes(subject));
    const runtime = createRuntime(960, 540, ordered);
    runtime.running = true;
    runtimeRef.current = runtime;
    scoreRef.current = createEmptyScores();
    setSubjectScores(createEmptyScores());
    pensRef.current = CONFIG.startingPens;
    setPensLeft(CONFIG.startingPens);
    setStartedSubjects(ordered);
    setFinishReason(null);
    finishedRateRef.current = null;
    phaseRef.current = "playing";
    setPhase("playing");
    prevTsRef.current = 0;
    window.setTimeout(() => canvasRef.current?.focus(), 0);
  }, []);

  const backToSelection = useCallback(() => {
    runtimeRef.current.running = false;
    phaseRef.current = "select";
    setPhase("select");
    setStartedSubjects([]);
    setFinishReason(null);
    prevTsRef.current = 0;
  }, []);

  const finishRound = useCallback((reason: FinishReason) => {
    if (phaseRef.current !== "playing") return;
    const runtime = runtimeRef.current;
    runtime.running = false;
    phaseRef.current = "finished";
    setPhase("finished");
    setFinishReason(reason);
    const rate = rateOf(runtime.scores, runtime.selectedSubjects);
    finishedRateRef.current = rate;
    commitBestRate(rate);
  }, [commitBestRate]);

  const resolveShot = useCallback(() => {
    const runtime = runtimeRef.current;
    const projectile = runtime.projectile;
    if (projectile.resolved) return;
    projectile.resolved = true;

    const allCapped = runtime.selectedSubjects.every(
      (subject) => runtime.scores[subject] >= CONFIG.maxScorePerSubject
    );
    if (allCapped) {
      finishRound("full");
      return;
    }
    if (pensRef.current <= 0) {
      finishRound("pens");
    }
  }, [finishRound]);

  const spawnPaper = useCallback((runtime: RuntimeState) => {
    const eligible = runtime.selectedSubjects.filter(
      (subject) => runtime.scores[subject] < CONFIG.maxScorePerSubject
    );
    if (eligible.length === 0) return;

    const subject = eligible[Math.floor(Math.random() * eligible.length)];
    const width = CONFIG.paperWidth;
    const height = CONFIG.paperHeight;
    const maxX = Math.floor(runtime.width * CONFIG.paperZoneRatio) - width - 8;
    const minX = 8;
    const x = Math.max(minX, Math.floor(Math.random() * Math.max(1, maxX - minX + 1)) + minX);
    const speedLevel =
      CONFIG.paperSpeedLevelMin +
      Math.random() * (CONFIG.paperSpeedLevelMax - CONFIG.paperSpeedLevelMin);
    const rampByTime = (runtime.elapsedMs / 1000 / 30) * CONFIG.paperTimeRampSpeed;
    const total = totalScoreOf(runtime.scores, runtime.selectedSubjects);
    const rampByScore = total * CONFIG.paperScoreRampSpeed;
    const levelMid = (CONFIG.paperSpeedLevelMin + CONFIG.paperSpeedLevelMax) / 2;
    const speed =
      ((CONFIG.paperBaseFallSpeed + rampByTime + rampByScore) * speedLevel) / levelMid;
    runtime.papers.push({ x, y: -height - 10, width, height, speed, subject });
  }, []);

  const fireProjectile = useCallback(() => {
    const runtime = runtimeRef.current;
    if (phaseRef.current !== "playing" || !runtime.running) return;
    const projectile = runtime.projectile;
    if (projectile.active) return;

    const x = Math.floor(runtime.width * (1 - CONFIG.playerZoneRatio / 2));
    const y = Math.round(runtime.playerY - projectile.height / 2);
    runtime.projectile = {
      ...projectile,
      active: true,
      x,
      y,
      angle: 0,
      // 負值＝逆時針旋轉（畫布 y 軸朝下，角度遞減即為逆時針）
      spinSpeed: -CONFIG.projectileSpinSpeed,
      hitsThisShot: 0,
      resolved: false,
    };
  }, []);

  const tick = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      frameRef.current = window.requestAnimationFrame(tick);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      frameRef.current = window.requestAnimationFrame(tick);
      return;
    }

    const runtime = runtimeRef.current;
    if (phaseRef.current !== "playing" || !runtime.running) {
      frameRef.current = window.requestAnimationFrame(tick);
      return;
    }

    if (prevTsRef.current === 0) {
      prevTsRef.current = timestamp;
    }
    const deltaMs = Math.min(40, timestamp - prevTsRef.current);
    prevTsRef.current = timestamp;
    const dt = deltaMs / 1000;

    runtime.elapsedMs += deltaMs;
    const playerMinY = 36;
    const playerMaxY = runtime.height - 36;

    if (runtime.moveUp) runtime.playerY -= CONFIG.moveSpeed * dt;
    if (runtime.moveDown) runtime.playerY += CONFIG.moveSpeed * dt;
    runtime.playerY = Math.max(playerMinY, Math.min(playerMaxY, runtime.playerY));

    const spawnInterval = Math.max(
      CONFIG.paperSpawnMinInterval,
      CONFIG.paperSpawnBaseInterval -
        (runtime.elapsedMs / 1000 / 18) * CONFIG.paperSpawnTimeRamp -
        totalScoreOf(runtime.scores, runtime.selectedSubjects) * CONFIG.paperSpawnScoreRamp
    );
    runtime.spawnAccumulator += dt;
    while (runtime.spawnAccumulator >= spawnInterval && runtime.running) {
      runtime.spawnAccumulator -= spawnInterval;
      spawnPaper(runtime);
    }

    runtime.papers.forEach((paper) => {
      paper.y += paper.speed * dt;
    });
    runtime.papers = runtime.papers.filter((paper) => paper.y < runtime.height + paper.height + 12);

    const projectile = runtime.projectile;
    if (projectile.active) {
      projectile.x -= projectile.speed * dt;
      projectile.angle += projectile.spinSpeed * dt;

      const projectileBox = {
        x: projectile.x,
        y: projectile.y,
        w: projectile.width,
        h: projectile.height,
      };
      const survivors: FallingPaper[] = [];
      let hitCount = 0;

      runtime.papers.forEach((paper) => {
        const paperBox = { x: paper.x, y: paper.y, w: paper.width, h: paper.height };
        if (!intersects(projectileBox, paperBox)) {
          survivors.push(paper);
          return;
        }

        hitCount += 1;
        projectile.hitsThisShot += 1;
        if (runtime.scores[paper.subject] < CONFIG.maxScorePerSubject) {
          runtime.scores[paper.subject] += 1;
        }
      });

      if (hitCount > 0) {
        playHit(audioCtxRef.current);
        scoreRef.current = { ...runtime.scores };
        setSubjectScores(scoreRef.current);
        runtime.papers = survivors.filter(
          (paper) => runtime.scores[paper.subject] < CONFIG.maxScorePerSubject
        );

        // 單支筆命中 ≥2 份試卷：畫面顯示對應成語（同數量有多句時亂數取一句）
        if (projectile.hitsThisShot >= 2) {
          runtime.celebration = {
            text: pickCelebration(projectile.hitsThisShot),
            ttlMs: CONFIG.celebrationDurationMs,
            durationMs: CONFIG.celebrationDurationMs,
          };
        }

        const allCapped = runtime.selectedSubjects.every(
          (subject) => runtime.scores[subject] >= CONFIG.maxScorePerSubject
        );
        if (allCapped) {
          projectile.resolved = true;
          finishRound("full");
        }
      }

      if (runtime.running && projectile.x + projectile.width < -20) {
        projectile.active = false;
        if (projectile.hitsThisShot === 0) {
          pensRef.current -= 1;
          setPensLeft(pensRef.current);
        }
        resolveShot();
      }
    }

    if (runtime.celebration) {
      runtime.celebration.ttlMs -= dt * 1000;
      if (runtime.celebration.ttlMs <= 0) {
        runtime.celebration = null;
      }
    }

    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = "#f9f9f9";
    ctx.fillRect(0, 0, runtime.width, runtime.height);

    runtime.papers.forEach((paper) => drawPaper(ctx, paper));

    const playerWidth = 96;
    const playerHeight = 60;
    const playerX = Math.floor(runtime.width * (1 - CONFIG.playerZoneRatio / 2)) - playerWidth / 2;
    const playerY = runtime.playerY - playerHeight / 2;

    if (!projectile.active) {
      drawPen(ctx, playerX, playerY, playerWidth, playerHeight);
    } else {
      ctx.save();
      const cx = projectile.x + projectile.width / 2;
      const cy = projectile.y + projectile.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(projectile.angle);
      drawPen(ctx, -projectile.width / 2, -projectile.height / 2, projectile.width, projectile.height);
      ctx.restore();
    }

    const celebration = runtime.celebration;
    if (celebration) {
      const ttl = Math.max(0, celebration.ttlMs);
      const progress = 1 - ttl / celebration.durationMs;
      const fadeMs = Math.min(500, celebration.durationMs);
      const alpha = ttl > fadeMs ? 1 : ttl / fadeMs;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${Math.max(28, Math.round(runtime.width * 0.07))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#ffffff";
      ctx.fillStyle = "#111111";
      const cx = runtime.width / 2;
      const cy = runtime.height * 0.3 - progress * 14;
      ctx.strokeText(celebration.text, cx, cy);
      ctx.fillText(celebration.text, cx, cy);
      ctx.restore();
    }

    frameRef.current = window.requestAnimationFrame(tick);
  }, [finishRound, resolveShot, spawnPaper]);

  const setPlayerYFromClientY = useCallback((clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.height === 0) return;
    const scaleY = canvas.height / rect.height;
    const y = (clientY - rect.top) * scaleY;
    const runtime = runtimeRef.current;
    runtime.playerY = Math.max(36, Math.min(runtime.height - 36, y));
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (phaseRef.current !== "playing") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    pointerDraggedRef.current = false;
    setPlayerYFromClientY(event.clientY);
  }, [setPlayerYFromClientY]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (phaseRef.current !== "playing") return;
    if (pointerStartRef.current) {
      const dx = event.clientX - pointerStartRef.current.x;
      const dy = event.clientY - pointerStartRef.current.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        pointerDraggedRef.current = true;
      }
    }
    setPlayerYFromClientY(event.clientY);
  }, [setPlayerYFromClientY]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const wasDrag = pointerDraggedRef.current;
    pointerStartRef.current = null;
    pointerDraggedRef.current = false;
    if (!wasDrag) {
      fireProjectile();
    }
  }, [fireProjectile]);

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerStartRef.current = null;
    pointerDraggedRef.current = false;
  }, []);

  const toggleSubject = useCallback((subject: Subject) => {
    setSelectedSubjects((prev) =>
      prev.includes(subject) ? prev.filter((item) => item !== subject) : [...prev, subject]
    );
  }, []);

  useEffect(() => {
    if (!open) return;

    prepareForSelection();
    const localBest = loadBestRate();
    bestRateRef.current = localBest;
    setBestRate(localBest);
    audioCtxRef.current = createHitContext();

    let cancelled = false;
    void (async () => {
      const session = await fetchSession(true);
      if (cancelled) return;
      const loggedIn = Boolean(session);
      loggedInRef.current = loggedIn;
      sessionReadyRef.current = true;
      setPlayerName(session ? session.displayName || session.account || "玩家" : "匿名");
      setPlayerRanked(loggedIn);

      if (!session) {
        setRemoteBestRate(null);
        remoteBestRateRef.current = null;
        return;
      }

      const remote = await loadRemoteBestRate();
      if (cancelled) return;

      if (remote !== null) {
        remoteBestRateRef.current = remote;
        setRemoteBestRate(remote);
        syncedRateRef.current = remote;
      }

      if (finishedRateRef.current !== null && finishedRateRef.current > 0) {
        const finalRate = finishedRateRef.current;
        if (syncedRateRef.current === null || finalRate > syncedRateRef.current) {
          syncedRateRef.current = finalRate;
          void syncRemoteBest(finalRate);
        }
      }
    })();

    bodyOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusCanvas = window.setTimeout(() => {
      canvasRef.current?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay();
        return;
      }
      if (phaseRef.current !== "playing") return;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        runtimeRef.current.moveUp = true;
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        runtimeRef.current.moveDown = true;
      } else if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        fireProjectile();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") runtimeRef.current.moveUp = false;
      if (event.key === "ArrowDown") runtimeRef.current.moveDown = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    frameRef.current = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      window.clearTimeout(focusCanvas);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.body.style.overflow = bodyOverflowRef.current;
      runtimeRef.current.moveUp = false;
      runtimeRef.current.moveDown = false;
      runtimeRef.current.running = false;
      loggedInRef.current = false;
      sessionReadyRef.current = false;
      syncedRateRef.current = null;
      setPlayerName("匿名");
      setPlayerRanked(false);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      if (audioCtxRef.current) {
        void audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, [closeOverlay, fireProjectile, open, prepareForSelection, syncRemoteBest, tick]);

  const totalScore = totalScoreOf(subjectScores, startedSubjects);
  const maxScore = maxScoreOf(startedSubjects);
  const currentRate = rateOf(subjectScores, startedSubjects);

  return (
    <>
      {!hideLauncher && (
        <button
          type="button"
          title="學測滿級分"
          onClick={() => setOpen(true)}
          style={launcherTop !== undefined ? { top: launcherTop } : undefined}
          className="fixed left-4 top-[124px] z-20 p-1 rounded border border-themed bg-card/80 hover:bg-surface transition-colors cursor-pointer"
          aria-label="開啟學測滿級分"
        >
          <svg
            viewBox="0 0 24 24"
            width={18}
            height={18}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="m9 15 2 2 4-4" />
          </svg>
        </button>
      )}

      {/* 行動裝置小螢幕：外層可垂直捲動，內容用 my-auto 安全置中，避免超出畫面時上下被裁切 */}
      {open && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center overflow-y-auto px-3 py-4">
          <div className="relative w-full max-w-[1020px] mx-auto my-auto">
            <button
              type="button"
              title="關閉（Esc）"
              onClick={closeOverlay}
              className="absolute -right-3 -top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-slate-500 bg-white text-black shadow hover:bg-slate-100 cursor-pointer"
              aria-label="關閉視窗"
            >
              <svg
                viewBox="0 0 24 24"
                width={16}
                height={16}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>

            <button
              type="button"
              onClick={toggleLeaderboard}
              className="absolute right-3 top-3 z-10 rounded border border-black bg-white px-2 py-1 text-xs sm:text-sm text-black hover:bg-slate-100 cursor-pointer"
            >
              {showBoard ? "關閉排行榜" : "排行榜"}
            </button>

            {phase === "select" ? (
              <div className="rounded border border-black bg-white px-5 py-6 text-black sm:px-8 sm:py-7">
                <h2 className="text-xl sm:text-2xl font-bold mb-1 text-center">學測滿級分</h2>
                <p className="text-sm text-slate-700 mb-4 text-center">
                  選擇至少 1 科開始；每科最高 15 級分，未命中一次扣 1 支筆。
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                  {SUBJECTS.map((subject) => {
                    const checked = selectedSubjects.includes(subject);
                    return (
                      <label
                        key={subject}
                        className={`flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm cursor-pointer ${
                          checked ? "border-black bg-slate-100" : "border-slate-300 bg-white"
                        }`}
                      >
                        <span>{subject}</span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSubject(subject)}
                          className="h-4 w-4 cursor-pointer"
                        />
                      </label>
                    );
                  })}
                </div>

                <div className="mb-4 text-center text-sm">
                  已選 {selectedSubjects.length} 科｜本局滿級分 {maxScoreOf(selectedSubjects)} 級分
                </div>

                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled={selectedSubjects.length === 0}
                    onClick={() => startGame(selectedSubjects)}
                    className="px-5 py-2 rounded border border-black bg-white text-black hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    開始遊戲
                  </button>
                </div>

                <p className="text-xs text-slate-700 mt-5 text-center">
                  滑鼠上下移動筆，點擊或空白鍵發射，Esc 關閉
                </p>
              </div>
            ) : (
              <>
                {/* 遊戲資訊狀態列：所有尺寸共用，獨立一行置於畫布上方（寬度上限與畫布一致，同步置中） */}
                <div className="mx-auto mb-1.5 w-full max-w-[calc((100dvh_-_9rem)*16/9)] flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded border border-black bg-white px-2.5 py-1 pr-20 font-mono text-xs sm:text-sm text-black">
                  <span className="shrink-0">級分 {totalScore}/{maxScore}</span>
                  <span className="shrink-0">筆 {pensLeft}</span>
                  <span className="shrink-0">達成率 {currentRate}%</span>
                  <span className="min-w-0 max-w-full truncate">
                    {startedSubjects.map((subject) => `${subject} ${subjectScores[subject]}`).join(" / ")}
                  </span>
                  <span className="min-w-0 max-w-full truncate">
                    玩家 {playerName}
                    {!playerRanked && "（不列入排行榜）"}
                  </span>
                  {bestRate !== null && <span className="shrink-0">本機最高 {bestRate}%</span>}
                  {playerRanked && (
                    <span className="shrink-0">榜上紀錄 {remoteBestRate !== null ? `${remoteBestRate}%` : "—"}</span>
                  )}
                </div>

                <canvas
                  ref={canvasRef}
                  width={960}
                  height={540}
                  tabIndex={0}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                  className="w-full h-auto max-h-[82vh] max-w-[calc((100dvh_-_9rem)*16/9)] mx-auto border border-slate-500 bg-[#f9f9f9] outline-none touch-none cursor-crosshair"
                  aria-label="學測滿級分互動畫布"
                />

                {phase === "finished" && (
                  <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-white/80 p-3">
                    <div className="my-auto w-[88%] max-w-[460px] rounded border border-black bg-white px-6 py-7 text-center text-black">
                      <h2 className="text-2xl font-bold mb-2">
                        {finishReason === "full" ? "滿級分！" : "筆數耗盡"}
                      </h2>
                      <p className="text-base mb-1">
                        達成率: {rateOf(scoreRef.current, startedSubjects)}%
                      </p>
                      <p className="text-base mb-1">
                        級分: {totalScoreOf(scoreRef.current, startedSubjects)} / {maxScore}
                      </p>
                      <div className="mb-4 grid grid-cols-2 gap-x-3 justify-center text-sm text-left">
                        {startedSubjects.map((subject) => (
                          <div key={subject}>
                            {subject}: {scoreRef.current[subject]}/{CONFIG.maxScorePerSubject}
                          </div>
                        ))}
                      </div>
                      {bestRate !== null && (
                        <p className="text-sm mb-1">本機最高達成率: {bestRate}%</p>
                      )}
                      {playerRanked && (
                        <p className="text-sm mb-1">
                          榜上紀錄: {remoteBestRate !== null ? `${remoteBestRate}%` : "—"}
                        </p>
                      )}
                      {!playerRanked && (
                        <p className="text-xs text-slate-700 mb-4">（不列入排行榜）</p>
                      )}
                      <p className="text-base mb-4 font-medium">再來一局？</p>
                      <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <button
                          type="button"
                          onClick={() => startGame(startedSubjects)}
                          className="px-4 py-2 rounded border border-black text-black hover:bg-slate-100 cursor-pointer"
                        >
                          再來一局
                        </button>
                        <button
                          type="button"
                          onClick={backToSelection}
                          className="px-4 py-2 rounded border border-black text-black hover:bg-slate-100 cursor-pointer"
                        >
                          重新選考
                        </button>
                        <button
                          type="button"
                          onClick={toggleLeaderboard}
                          className="px-4 py-2 rounded border border-black text-black hover:bg-slate-100 cursor-pointer"
                        >
                          排行榜
                        </button>
                        <button
                          type="button"
                          onClick={closeOverlay}
                          className="px-4 py-2 rounded border border-black text-black hover:bg-slate-100 cursor-pointer"
                        >
                          關閉
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {showBoard && (
              <div className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-white/90 p-3">
                <div className="my-auto w-full max-w-[480px] max-h-[86%] overflow-auto rounded border border-black bg-white p-4 text-black">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-lg font-bold">學測滿級分排行榜 TOP 100</h3>
                    <button
                      type="button"
                      onClick={() => setShowBoard(false)}
                      className="text-sm underline cursor-pointer"
                    >
                      關閉
                    </button>
                  </div>
                  {boardMy && (
                    <p className="mb-3 text-sm">
                      我的名次: {boardMy.rank ?? "未上榜"}（{boardMy.score}%
                      {boardMy.recordDate ? `，${boardMy.recordDate}` : ""}）
                    </p>
                  )}
                  {boardLoading ? (
                    <p className="text-sm text-t3">載入中...</p>
                  ) : boardRows.length === 0 ? (
                    <p className="text-sm text-t3">尚無資料</p>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-black">
                          <th className="py-1 pr-2">#</th>
                          <th className="py-1 pr-2">名稱</th>
                          <th className="py-1 pr-2">身分</th>
                          <th className="py-1 pr-2">達成率</th>
                          <th className="py-1 text-right">紀錄日期</th>
                        </tr>
                      </thead>
                      <tbody>
                        {boardRows.map((row) => (
                          <tr key={`${row.rank}-${row.name}`} className="border-b border-slate-200">
                            <td className="py-1 pr-2">{row.rank}</td>
                            <td className="py-1 pr-2">{row.name}</td>
                            <td className="py-1 pr-2">{row.roleLabel}</td>
                            <td className="py-1 pr-2">{row.score}%</td>
                            <td className="py-1 text-right whitespace-nowrap">{row.recordDate || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
