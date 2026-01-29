"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Wallet } from "@coinbase/onchainkit/wallet";
import { useMiniKit } from "@coinbase/onchainkit/minikit";
import styles from "./page.module.css";

type Note = {
  id: string;
  lane: number;
  time: number;
  hit: boolean;
  missed: boolean;
};

const LANES = [
  { id: 0, key: "D", label: "D", color: "#4CF2FF" },
  { id: 1, key: "F", label: "F", color: "#8B6CFF" },
  { id: 2, key: "J", label: "J", color: "#FF7AD9" },
  { id: 3, key: "K", label: "K", color: "#FFC857" },
];

const BPM = 128;
const BEAT_MS = 60000 / BPM;
const DURATION_MS = 30000;
const TRAVEL_MS = 2400;
const HIT_WINDOW_MS = 220;

export default function Home() {
  const { setMiniAppReady, isMiniAppReady } = useMiniKit();
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const musicTimerRef = useRef<number | null>(null);
  const musicStepRef = useRef(0);

  const [gameState, setGameState] = useState<"idle" | "running" | "over">(
    "idle"
  );
  const [notes, setNotes] = useState<Note[]>([]);
  const [now, setNow] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [best, setBest] = useState(0);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [lastHit, setLastHit] = useState<string>("Ready");
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [isRecord, setIsRecord] = useState(false);

  useEffect(() => {
    if (!isMiniAppReady) {
      setMiniAppReady();
    }
  }, [setMiniAppReady, isMiniAppReady]);

  const generateNotes = useMemo(() => {
    const sequence: Note[] = [];
    let cursor = 0;
    let id = 0;
    while (cursor < DURATION_MS) {
      if (Math.random() > 0.25) {
        const lane = Math.floor(Math.random() * LANES.length);
        const jitter = (Math.random() - 0.5) * 80;
        sequence.push({
          id: `note-${id++}`,
          lane,
          time: Math.max(0, cursor + jitter),
          hit: false,
          missed: false,
        });
      }
      cursor += BEAT_MS / 2;
    }
    return sequence;
  }, []);

  const resetGame = () => {
    startTimeRef.current = null;
    setNow(0);
    setScore(0);
    setCombo(0);
    setHits(0);
    setMisses(0);
    setLastHit("Ready");
    setIsRecord(false);
    setNotes(
      generateNotes.map((note) => ({
        ...note,
        hit: false,
        missed: false,
      }))
    );
    setGameState("idle");
  };

  useEffect(() => {
    try {
      const stored = localStorage.getItem("glowRushBest");
      if (stored) {
        const value = Number(stored);
        if (!Number.isNaN(value)) {
          setBest(value);
        }
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const playTone = (frequency: number, duration = 0.08, volume = 0.06) => {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  };

  const playKick = (ctx: AudioContext, time: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(50, time + 0.12);
    gain.gain.setValueAtTime(0.18, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.2);
  };

  const playHat = (ctx: AudioContext, time: number) => {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(time);
    noise.stop(time + 0.15);
  };

  const playMelody = (ctx: AudioContext, time: number, frequency: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(0.06, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.24);
  };

  const playVictory = () => {
    const ctx = getAudioContext();
    const nowTime = ctx.currentTime;
    playMelody(ctx, nowTime, 523);
    playMelody(ctx, nowTime + 0.12, 659);
    playMelody(ctx, nowTime + 0.24, 784);
  };

  const startMusic = () => {
    const ctx = getAudioContext();
    if (musicTimerRef.current) return;
    musicStepRef.current = 0;
    const interval = BEAT_MS / 2;
    const melody = [392, 440, 523, 587, 659, 587, 523, 440];
    const schedule = () => {
      const step = musicStepRef.current;
      const nowTime = ctx.currentTime;
      if (step % 4 === 0) {
        playKick(ctx, nowTime);
      }
      if (step % 2 === 1) {
        playHat(ctx, nowTime);
      }
      if (step % 4 === 2) {
        playMelody(ctx, nowTime, melody[(step / 2) % melody.length]);
      }
      musicStepRef.current += 1;
    };
    schedule();
    musicTimerRef.current = window.setInterval(schedule, interval);
  };

  const stopMusic = () => {
    if (musicTimerRef.current) {
      clearInterval(musicTimerRef.current);
      musicTimerRef.current = null;
    }
  };

  useEffect(() => {
    resetGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (gameState !== "running") {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      return;
    }

    const loop = (timestamp: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp;
      }
      const elapsed = timestamp - startTimeRef.current;

      if (timestamp - lastTickRef.current > 16) {
        lastTickRef.current = timestamp;
        setNow(elapsed);
      }

      setNotes((prev) => {
        let changed = false;
        const updated = prev.map((note) => {
          if (note.hit || note.missed) {
            return note;
          }
          if (elapsed - note.time > HIT_WINDOW_MS) {
            changed = true;
            return { ...note, missed: true };
          }
          return note;
        });

        if (changed) {
          setCombo(0);
          setMisses((count) => count + 1);
          setLastHit("Miss");
        }
        return updated;
      });

      if (elapsed > DURATION_MS + TRAVEL_MS) {
        setGameState("over");
        setBest((prev) => {
          const nextBest = Math.max(prev, score);
          if (score > prev) {
            setIsRecord(true);
            playVictory();
            try {
              localStorage.setItem("glowRushBest", String(nextBest));
            } catch {
              // ignore storage errors
            }
          }
          return nextBest;
        });
        stopMusic();
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [gameState, score]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (gameState !== "running") return;
      const lane = LANES.find((item) => item.key === event.key.toUpperCase());
      if (lane) {
        event.preventDefault();
        handleHit(lane.id);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [gameState, notes]);

  const startGame = () => {
    resetGame();
    if (musicEnabled) {
      startMusic();
    }
    setGameState("running");
  };

  const handleHit = (lane: number) => {
    if (gameState !== "running" || !startTimeRef.current) return;
    const elapsed = now;
    let closest: Note | null = null;
    let closestDiff = Infinity;

    for (const note of notes) {
      if (note.lane !== lane || note.hit || note.missed) continue;
      const diff = Math.abs(note.time - elapsed);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = note;
      }
    }

    if (!closest || closestDiff > HIT_WINDOW_MS) {
      setCombo(0);
      setMisses((count) => count + 1);
      setLastHit("Miss");
      playTone(180, 0.06, 0.05);
      return;
    }

    setNotes((prev) =>
      prev.map((note) =>
        note.id === closest?.id ? { ...note, hit: true } : note
      )
    );

    const accuracy = Math.max(0.5, 1 - closestDiff / HIT_WINDOW_MS);
    const gained = Math.round(120 * accuracy + combo * 4);
    setScore((value) => value + gained);
    setCombo((value) => value + 1);
    setHits((value) => value + 1);
    setLastHit(`${closestDiff < 40 ? "Perfect" : "Great"} +${gained}`);
    playTone(closestDiff < 40 ? 640 : 520, 0.07, 0.07);
  };

  const progress = Math.min(now / DURATION_MS, 1);
  const accuracyPct = hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) : 0;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.subtitle}>Neon Rhythm</p>
          <h1 className={styles.title}>Glow Rush</h1>
          <p className={styles.tagline}>
            Hit the beats, build combo, and keep the streak alive.
          </p>
        </div>
        <Wallet />
      </header>

      <section className={styles.board}>
        <div className={styles.panel}>
          <div className={styles.statusRow}>
            <span className={styles.badge}>
              {gameState === "running" ? "Live" : "Warm-up"}
            </span>
            <span>{Math.max(0, Math.ceil((DURATION_MS - now) / 1000))}s</span>
          </div>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${progress * 100}%` }}
            />
          </div>

          <div className={styles.laneGrid}>
            {LANES.map((lane) => (
              <div key={lane.id} className={styles.lane}>
                <div className={styles.laneGlow} />
                <div className={styles.hitLine} />
                {notes
                  .filter((note) => note.lane === lane.id)
                  .map((note) => {
                    const progress =
                      (now - (note.time - TRAVEL_MS)) / TRAVEL_MS;
                    const isVisible = progress > -0.1 && progress < 1.3;
                    if (!isVisible || note.hit) return null;
                    const laneTarget = 84;
                    const y = Math.min(110, Math.max(-10, progress * laneTarget));
                    const noteClass = note.missed
                      ? styles.noteMissed
                      : styles.note;
                    return (
                      <span
                        key={note.id}
                        className={noteClass}
                        style={{
                          background: lane.color,
                          top: `calc(${y}% - 9px)`,
                          left: "50%",
                        }}
                      />
                    );
                  })}
              </div>
            ))}
          </div>

          <div className={styles.padRow}>
            {LANES.map((lane) => (
              <button
                key={lane.id}
                className={styles.pad}
                style={{ background: lane.color }}
                onClick={() => handleHit(lane.id)}
              >
                {lane.label}
              </button>
            ))}
          </div>
        </div>

        <aside className={styles.side}>
          <div className={styles.scoreCard}>
            <p className={styles.scoreLabel}>Score</p>
            <p className={styles.scoreValue}>{score}</p>
            <div className={styles.scoreRow}>
              <span>Combo</span>
              <span>{combo}</span>
            </div>
            <div className={styles.scoreRow}>
              <span>Accuracy</span>
              <span>{accuracyPct}%</span>
            </div>
            <div className={styles.scoreRow}>
              <span>Best</span>
              <span>{Math.max(best, score)}</span>
            </div>
            {isRecord ? (
              <div className={styles.recordBadge}>New Record!</div>
            ) : null}
          </div>

          <div className={styles.callout}>
            <p className={styles.calloutTitle}>{lastHit}</p>
            <p className={styles.calloutBody}>
              Press {LANES.map((lane) => lane.key).join(" ")} or tap the pads.
              Keep within {HIT_WINDOW_MS}ms for max points.
            </p>
          </div>

          <div className={styles.actions}>
            {gameState !== "running" ? (
              <button className={styles.primary} onClick={startGame}>
                {gameState === "over" ? "Play Again" : "Start Run"}
              </button>
            ) : (
              <button
                className={styles.secondary}
                onClick={() => {
                  stopMusic();
                  resetGame();
                }}
              >
                Reset
              </button>
            )}
            <button
              className={styles.toggle}
              onClick={() => {
                setMusicEnabled((prev) => {
                  const next = !prev;
                  if (!next) {
                    stopMusic();
                  } else if (gameState === "running") {
                    startMusic();
                  }
                  return next;
                });
              }}
            >
              Sound: {musicEnabled ? "On" : "Off"}
            </button>
          </div>
        </aside>
      </section>
    </div>
  );
}
