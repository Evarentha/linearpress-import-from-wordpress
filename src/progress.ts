/*
 * Import Progress Singleton State
 *
 * Tracks the single in-flight import's phases, per-task progress, and stats for the initiator.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Singleton state for import progress.
 *
 * <p>During maintenance mode the progress is visible only to the initiating session: both the
 * progress page and the polling API check initiatorSessionId, so every other visitor just sees
 * the ordinary maintenance home page.</p>
 *
 * Task display:
 * <ul>
 * <li>While running: "正在导入媒体 (27/196)" (importing media 27/196).</li>
 * <li>When finished: "已导入媒体 (137/137)" (media imported 137/137).</li>
 * </ul>
 *
 * @since 1.0.0
 */

export type ImportPhase = 'parse' | 'media' | 'categories' | 'users' | 'posts' | 'comments' | 'site' | 'profiles' | 'done' | 'failed';

export interface ImportTaskView {
  /** 阶段基础名（媒体 / 用户 / 文章 / 评论 …）。 */
  base: string;
  /** 最终展示文案（完成时烘焙，运行中由快照拼装）。 */
  label: string;
  done: boolean;
  progress: number;
  /** 自定义完成文案（如“跳过”场景）；为 null 时用默认「已导入 …」格式。 */
  finalLabel: string | null;
}

export interface ImportStats {
  media: number;
  mediaFailed: number;
  users: number;
  posts: number;
  postUpdates: number;
  postSkips: number;
  comments: number;
  categories: number;
  profiles: number;
}

export interface ImportState {
  running: boolean;
  phase: ImportPhase;
  startedAt: string | null;
  finishedAt: string | null;
  failed: string | null;
  current: number;
  total: number;
  tasks: ImportTaskView[];
  stats: ImportStats;
  initiatorSessionId: string | null;
  note: string | null;
}

function freshStats(): ImportStats {
  return { media: 0, mediaFailed: 0, users: 0, posts: 0, postUpdates: 0, postSkips: 0, comments: 0, categories: 0, profiles: 0 };
}

function createInitialState(): ImportState {
  return {
    running: false,
    phase: 'parse',
    startedAt: null,
    finishedAt: null,
    failed: null,
    current: 0,
    total: 0,
    tasks: [],
    stats: freshStats(),
    initiatorSessionId: null,
    note: null
  };
}

const state = createInitialState();

export function importState(): ImportState {
  return state;
}

export function isImportRunning(): boolean {
  return state.running;
}

/** 开始一次导入（若已有导入进行中返回 false）。 */
export function beginImport(sessionId: string): boolean {
  if (state.running) return false;
  state.running = true;
  state.phase = 'parse';
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.failed = null;
  state.current = 0;
  state.total = 0;
  state.tasks = [];
  state.stats = freshStats();
  state.initiatorSessionId = sessionId;
  state.note = null;
  return true;
}

export function setPhase(phase: ImportPhase, total = 0, base = '', finalLabel?: string): void {
  state.phase = phase;
  state.current = 0;
  state.total = total;
  if (base) state.tasks.push({ base, label: '', done: false, progress: 0, finalLabel: finalLabel ?? null });
}

interface InternalTask extends ImportTaskView { finalLabel: string | null; }

/** 当前阶段推进一个单位。 */
export function advance(count = 1): void {
  state.current = Math.min(state.current + count, state.total || Number.MAX_SAFE_INTEGER);
  const task = state.tasks[state.tasks.length - 1] as InternalTask | undefined;
  if (task && !task.done && state.total > 0) task.progress = Math.round((state.current / state.total) * 100);
}

/** 结束当前阶段（烘焙为「已导入 … (total/total)」或自定义文案）。 */
export function finishPhase(): void {
  const task = state.tasks[state.tasks.length - 1] as InternalTask | undefined;
  if (task && !task.done) {
    task.done = true;
    task.progress = 100;
    task.label = task.finalLabel ?? `已导入${task.base}${state.total > 0 ? ` (${state.total}/${state.total})` : ''}`;
  }
  state.current = 0;
  state.total = 0;
}

export function addStat(key: keyof ImportStats, count = 1): void {
  state.stats[key] += count;
}

export function failImport(message: string): void {
  state.running = false;
  state.phase = 'failed';
  state.failed = message;
  state.finishedAt = new Date().toISOString();
  state.note = '导入过程中出现异常，已完成的部分已保留。请检查日志后重试；重试时已导入的媒体与同名文章会被复用或覆盖。';
}

export function finishImport(note: string | null = null): void {
  state.running = false;
  state.phase = 'done';
  state.finishedAt = new Date().toISOString();
  state.note = note;
}

/** 运行中文案：正在导入X (cur/total)。 */
function displayFor(task: ImportTaskView, state: ImportState): string {
  if (task.done || task.label) return task.label;
  const suffix = state.total > 0 ? ` (${state.current}/${state.total})` : '';
  return `正在导入${task.base}${suffix}`;
}

/** 生成发起者专属的进度页数据（他人访问返回 null）。 */
export function snapshotFor(sessionId: string): ImportState | null {
  if (state.initiatorSessionId !== sessionId) return null;
  return {
    ...state,
    stats: { ...state.stats },
    tasks: state.tasks.map((task) => ({
      ...task,
      label: displayFor(task, state)
    }))
  };
}