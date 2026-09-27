import { AudioEngine } from './audio/audio';
import { T } from './i18n/de';
import { GameRenderer } from './render/renderer';
import { SCENARIOS } from './sim/scenarios';
import { F_ARRESTED, F_GLUED, F_SIT, SnapUnit, Snapshot } from './sim/snapshot';
import { ABILITIES, Ability, DEMO_KINDS, Kind, POLICE_KINDS, STATS, Side } from './sim/types';
import type { FromWorker, ToWorker } from './sim/worker';
import type { Command, Difficulty, GameEvent } from './sim/world';
import { Minimap } from './ui/minimap';

type Mode = 'attract' | 'playing' | 'ended';
type PlayerSide = Side.Police | Side.Demo;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const NEWS_THROTTLE: Record<string, number> = { arrest: 4000, recruit: 5000, home: 6000, clear: 4000, jail: 6000, release: 6000, buy: 3000, horse: 6000, spray: 5000, glue: 4000, unglue: 5000, injury: 3000, megaphone: 5000, carblock: 3000, extinguish: 4000 };

export class Game {
  renderer = new GameRenderer();
  audio = new AudioEngine();
  worker!: Worker;
  minimap!: Minimap;
  mode: Mode = 'attract';
  side: PlayerSide = Side.Police;
  scenario = SCENARIOS[0].id;
  difficulty: Difficulty = 'normal';
  paused = false;
  speed = 1;
  snap: Snapshot | null = null;
  private groups = new Map<number, number[]>();
  private keys = new Set<string>();
  private lastTension = -1e9;
  private selStart: { x: number; y: number } | null = null;
  private panLast: { x: number; y: number } | null = null;
  private lastNews = new Map<string, number>();
  private abilityKey = '';
  private buyBuilt: PlayerSide | null = null;
  private attractT = 0;
  private lastGroupKey = { n: -1, t: 0 };
  ready = false;

  async init() {
    await this.renderer.init($('stage'));
    this.minimap = new Minimap($<HTMLCanvasElement>('minimap'));
    this.minimap.onJump = (x, y) => this.renderer.centerOn(x, y);
    this.worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
    this.setupMenu();
    this.setupInput();
    this.setupHud();
    this.renderer.app.ticker.add((t) => this.tick(t.deltaMS));
    this.startAttract();
    this.ready = true;
    this.exposeTestHooks();
  }

  private post(m: ToWorker) {
    this.worker.postMessage(m);
  }

  // ------------------------------------------------------------------ flow

  startAttract() {
    this.mode = 'attract';
    this.snap = null;
    this.renderer.selected.clear();
    $('hud').hidden = true;
    $('end').hidden = true;
    $('menu').hidden = false;
    const sc = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)].id;
    this.post({ type: 'start', scenario: sc, side: Side.Police, difficulty: 'normal', seed: Math.floor(Math.random() * 1e6), spectate: true });
    this.post({ type: 'speed', value: 2 });
    if (this.audio.ctx) this.audio.play('menu');
  }

  startGame() {
    this.audio.unlock();
    this.mode = 'playing';
    this.snap = null;
    this.paused = false;
    this.speed = 1;
    this.groups.clear();
    this.renderer.selected.clear();
    this.abilityKey = '';
    $('menu').hidden = true;
    $('end').hidden = true;
    $('hud').hidden = false;
    $('pausebanner').hidden = true;
    $('btn-speed').textContent = '1×';
    $('ticker').innerHTML = '';
    $('hud-scenario').textContent = T.scenarios[this.scenario].name;
    this.buildBuyPanel();
    this.post({ type: 'start', scenario: this.scenario, side: this.side, difficulty: this.difficulty, seed: Math.floor(Math.random() * 1e6) });
    this.audio.play('game');
    this.lastTension = -1e9;
  }

  private onMessage(m: FromWorker) {
    if (m.type !== 'snap') return;
    this.post({ type: 'ack' });
    if (m.map) {
      this.renderer.buildMap(m.map);
      this.minimap.setMap(m.map);
      if (this.mode === 'playing') {
        const sp = this.side === Side.Police ? m.map.policeHQ : m.map.demoMeet;
        this.renderer.centerOn(sp.x, sp.y);
      } else this.renderer.centerOn(34, 34);
    }
    const snap = m.snap;
    this.snap = snap;
    this.renderer.pushSnapshot(snap);
    if (this.mode === 'attract') {
      if (snap.result) this.startAttract();
      return;
    }
    if (this.mode !== 'playing') return;
    this.handleEvents(snap.events);
    this.updateHud(snap);
    if (snap.result) this.showEnd(snap);
  }

  private showEnd(snap: Snapshot) {
    this.mode = 'ended';
    const r = snap.result!;
    const won = r.winner === this.side;
    $('end').hidden = false;
    const head = $('end-head');
    head.textContent = won ? T.end.won : T.end.lost;
    head.className = won ? 'won' : 'lost';
    $('end-title').textContent = `${T.scenarios[this.scenario].name} – ${won ? T.end.won : T.end.lost}`;
    $('end-reason').textContent = T.end.reasons[`${r.reason}_${r.winner === Side.Police ? 'police' : 'demo'}`] ?? '';
    const rows = Object.entries(T.end.statLabels)
      .map(([k, label]) => `<tr><td>${label}</td><td>${Math.round((snap.stats as any)[k] ?? 0)}</td></tr>`)
      .join('');
    $('end-stats').innerHTML = rows + `<tr><td>${T.hud.opinion}</td><td>${Math.round(snap.opinion)} / 100</td></tr>`;
    this.audio.play(won ? 'win' : 'lose');
    setTimeout(() => {
      if (this.mode === 'ended') this.audio.play('menu');
    }, 5000);
  }

  // ------------------------------------------------------------------ menu

  private setupMenu() {
    $('menu-subtitle').textContent = `${T.subtitle} – ${T.city}`;
    $('menu-footer').textContent = T.menu.footer;
    $('menu-help').innerHTML = T.help.map((h) => `<li>${h}</li>`).join('');
    const sc = $('scenarios');
    sc.innerHTML = '';
    for (const s of SCENARIOS) {
      const t = T.scenarios[s.id];
      const b = document.createElement('button');
      b.className = 'scen' + (s.id === this.scenario ? ' on' : '');
      b.dataset.id = s.id;
      b.innerHTML = `<b>${t.name}</b><small>${t.cause}</small>`;
      b.onclick = () => {
        this.scenario = s.id;
        sc.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        this.audio.click();
        this.updateGoal();
      };
      sc.appendChild(b);
    }
    const toggle = (id: string, attr: string, fn: (v: string) => void) => {
      const box = $(id);
      box.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => {
          box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
          fn(b.getAttribute(attr)!);
          this.audio.click();
          this.updateGoal();
        }),
      );
    };
    toggle('side-toggle', 'data-side', (v) => (this.side = Number(v) as PlayerSide));
    toggle('diff-toggle', 'data-diff', (v) => (this.difficulty = v as Difficulty));
    toggle('music-toggle', 'data-music', (v) => this.setMusic(v === '1'));
    $('start').onclick = () => this.startGame();
    $('end-again').onclick = () => this.startGame();
    $('end-menu').onclick = () => this.startAttract();
    this.updateGoal();
    // browsers only allow audio after a user gesture
    const unlock = () => {
      this.audio.unlock();
      if (this.mode === 'attract') this.audio.play('menu');
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private setMusic(on: boolean) {
    this.audio.setMusic(on);
    $('btn-music').classList.toggle('on', !on);
    $('music-toggle')
      .querySelectorAll('button')
      .forEach((b) => b.classList.toggle('on', (b.getAttribute('data-music') === '1') === on));
  }

  private updateGoal() {
    const t = T.scenarios[this.scenario];
    $('goal').innerHTML = `<b>${t.name}</b> – ${t.intro}<br><br><b>${this.side === Side.Police ? T.menu.police : T.menu.demo}:</b> ${
      this.side === Side.Police ? t.policeGoal : t.demoGoal
    }`;
  }

  // ------------------------------------------------------------------ HUD

  private setupHud() {
    $('btn-pause').onclick = () => this.togglePause();
    $('btn-speed').onclick = () => {
      this.speed = (this.speed % 3) + 1;
      $('btn-speed').textContent = `${this.speed}×`;
      this.post({ type: 'speed', value: this.speed });
      this.audio.click();
    };
    $('btn-music').onclick = () => this.setMusic(!this.audio.musicOn);
    $('btn-rot-left').onclick = () => this.rotateView(-1);
    $('btn-rot-right').onclick = () => this.rotateView(1);
    $('btn-help').onclick = () => this.toggleHelp();
    $('btn-menu').onclick = () => this.startAttract();
    $('helpbox').innerHTML = `<div class="title">${T.menu.help}</div><ul>${T.help.map((h) => `<li>${h}</li>`).join('')}</ul>`;
    $('helpbox').onclick = () => this.toggleHelp();
  }

  private rotateView(step: number) {
    this.renderer.rotate(step);
    this.minimap.setRotation(this.renderer.rot);
    if (this.snap) this.updateHud(this.snap);
    this.audio.click();
  }

  private toggleHelp() {
    $('helpbox').hidden = !$('helpbox').hidden;
  }

  private togglePause() {
    if (this.mode !== 'playing') return;
    this.paused = !this.paused;
    this.post({ type: 'pause', value: this.paused });
    $('pausebanner').hidden = !this.paused;
    $('btn-pause').classList.toggle('on', this.paused);
  }

  private buildBuyPanel() {
    const box = $('buy');
    box.innerHTML = '';
    const kinds = this.side === Side.Police ? POLICE_KINDS : DEMO_KINDS;
    for (const k of kinds) {
      const b = document.createElement('button');
      b.dataset.kind = String(k);
      b.title = T.kindInfo[k];
      b.innerHTML = `<span>${T.kinds[k]}</span><span class="cost">${STATS[k].cost}</span>`;
      b.onclick = () => this.buy(k);
      box.appendChild(b);
    }
    $('buy-title').textContent = this.side === Side.Police ? T.hud.buy : 'Unterstützer mobilisieren';
    this.buyBuilt = this.side;
  }

  private buy(k: Kind) {
    this.send({ t: 'buy', side: this.side, kind: k });
    this.audio.cash();
    if (this.side === Side.Police && (k === Kind.Wasserwerfer || k === Kind.Transporter)) this.audio.siren();
  }

  private updateHud(s: Snapshot) {
    const rem = Math.max(0, s.duration - s.tick) / 10;
    $('hud-time').textContent = `${String(Math.floor(rem / 60)).padStart(2, '0')}:${String(Math.floor(rem % 60)).padStart(2, '0')}`;
    const funds = s.funds[this.side];
    $('hud-funds').textContent = String(Math.floor(funds));
    $('hud-opmark').style.left = `${s.opinion}%`;
    const obj = SCENARIOS.find((x) => x.id === this.scenario)!.objective;
    $('hud-objbar').style.width = `${(100 * s.progress) / s.target}%`;
    if (obj.type === 'blockade') {
      $('hud-objlabel').textContent = T.hud.blockade;
      $('hud-objtext').textContent = `${s.objBlocked}/${obj.points.length} ${T.hud.junctions} · ${Math.floor(s.progress)}/${s.target}`;
    } else {
      $('hud-objlabel').textContent = T.hud.hold;
      $('hud-objtext').textContent = `${s.objBlocked}/${obj.count} ${T.hud.inZone} · ${Math.floor(s.progress / 10)}/${s.target / 10} s`;
    }
    $('hud-jam').textContent = `${s.jam} ${T.hud.cars}`;
    if (this.buyBuilt !== this.side) this.buildBuyPanel();
    $('buy')
      .querySelectorAll('button')
      .forEach((b) => ((b as HTMLButtonElement).disabled = funds < STATS[Number((b as HTMLElement).dataset.kind)].cost));
    this.updateSelectionPanel(s);
    const r = this.renderer.app.screen;
    const corners = [
      this.renderer.screenToWorld(0, 0),
      this.renderer.screenToWorld(r.width, 0),
      this.renderer.screenToWorld(r.width, r.height),
      this.renderer.screenToWorld(0, r.height),
    ];
    this.minimap.draw(s, corners);
  }

  private selectedUnits(): SnapUnit[] {
    if (!this.snap) return [];
    return this.snap.units.filter((u) => this.renderer.selected.has(u.id));
  }

  private updateSelectionPanel(_s: Snapshot) {
    const sel = this.selectedUnits();
    const info = $('sel-info');
    if (sel.length === 0) {
      info.innerHTML = `<span class="hint">${T.hud.none}</span>`;
    } else {
      const counts = new Map<Kind, number>();
      for (const u of sel) counts.set(u.k, (counts.get(u.k) ?? 0) + 1);
      let html = `<b>${T.hud.selected}: ${sel.length}</b><div class="kinds">`;
      for (const [k, n] of counts) html += `<span class="chip" title="${T.kindInfo[k]}">${n}× ${T.kinds[k]}</span>`;
      html += '</div>';
      if (sel.length === 1) {
        const u = sel[0];
        const bits: string[] = [T.kindInfo[u.k] ?? ''];
        if (u.s === Side.Demo) bits.push(`${T.hud.morale}: ${Math.round(u.m)}`);
        if (u.k === Kind.Transporter) bits.push(`${T.hud.cargo}: ${u.c}/10`);
        if (u.k === Kind.Autotrupp) bits.push(`${T.hud.uses}: ${u.c}`);
        if (u.f & F_GLUED) bits.push('festgeklebt');
        else if (u.f & F_SIT) bits.push('sitzt');
        if (u.f & F_ARRESTED) bits.push('festgenommen');
        html += `<small>${bits.join(' · ')}</small>`;
      }
      info.innerHTML = html;
    }
    const abilities = new Set<Ability>();
    for (const u of sel) for (const a of ABILITIES[u.k] ?? []) abilities.add(a);
    const key = [...abilities].sort().join(',');
    if (key !== this.abilityKey) {
      this.abilityKey = key;
      const box = $('sel-abilities');
      box.innerHTML = '';
      for (const a of abilities) {
        const b = document.createElement('button');
        b.innerHTML = `${T.abilities[a]}<kbd>${T.hotkeys[a]}</kbd>`;
        b.onclick = () => this.ability(a);
        box.appendChild(b);
      }
    }
  }

  private ticker(text: string, live = false) {
    const box = $('ticker');
    const d = document.createElement('div');
    d.textContent = text;
    if (live) d.className = 'live';
    box.prepend(d);
    while (box.children.length > 4) box.lastElementChild!.remove();
    setTimeout(() => (d.style.opacity = '0'), 4000);
    setTimeout(() => d.remove(), 4700);
  }

  private onScreen(e: GameEvent): boolean {
    const p = this.renderer.worldToScreen(e.x, e.y);
    const r = this.renderer.app.screen;
    return p.x > -150 && p.y > -150 && p.x < r.width + 150 && p.y < r.height + 150;
  }

  private handleEvents(events: GameEvent[]) {
    const now = performance.now();
    for (const e of events) {
      const visible = this.onScreen(e);
      switch (e.k) {
        case 'spray':
          this.lastTension = now;
          if (visible) this.audio.spray();
          break;
        case 'fire':
          this.lastTension = now;
          if (visible) this.audio.fire();
          break;
        case 'injury':
          this.lastTension = now;
          if (visible) this.audio.injury();
          break;
        case 'horse':
          if (visible) this.audio.horse();
          break;
        case 'arrest':
          if (visible) this.audio.arrest();
          break;
        case 'megaphone':
          if (visible) this.audio.megaphone();
          break;
        case 'recruit':
          if (visible) this.audio.recruit();
          break;
        case 'live':
          this.audio.news();
          break;
        case 'buy':
          if (e.side !== this.side) continue; // don't leak enemy purchases
          break;
      }
      const text = e.k === 'live' ? T.news.live : T.news[e.k];
      if (!text) continue;
      const gap = e.k === 'live' ? 8000 : NEWS_THROTTLE[e.k] ?? 3000;
      if ((this.lastNews.get(e.k) ?? 0) + gap > now) continue;
      if (e.k !== 'live' && e.k !== 'fire' && e.k !== 'buy' && !this.snap?.vis[Math.floor(e.y) * (this.renderer.map?.w ?? 64) + Math.floor(e.x)]) continue;
      this.lastNews.set(e.k, now);
      this.ticker(text, e.k === 'live' || e.k === 'fire');
    }
    const wantTension = now - this.lastTension < 20000;
    const cur = this.audio.current;
    if (wantTension && cur === 'game') this.audio.play('tension');
    else if (!wantTension && cur === 'tension') this.audio.play('game');
  }

  // ------------------------------------------------------------------ commands

  private send(cmd: Command) {
    this.post({ type: 'cmd', cmd });
  }

  private ability(a: Ability) {
    const ids = this.selectedUnits()
      .filter((u) => ABILITIES[u.k]?.includes(a))
      .map((u) => u.id);
    if (ids.length === 0) return;
    this.send({ t: 'ability', side: this.side, ids, a });
    this.audio.ack(this.side === Side.Police);
  }

  private moveSelected(sx: number, sy: number) {
    const ids = this.selectedUnits().map((u) => u.id);
    if (ids.length === 0) return;
    const w = this.renderer.screenToWorld(sx, sy);
    this.send({ t: 'move', side: this.side, ids, x: w.x, y: w.y });
    this.renderer.markMove(w.x, w.y);
    this.audio.ack(this.side === Side.Police);
  }

  /** own unit closest to a screen point (within 22 px) */
  private pick(sx: number, sy: number): SnapUnit | null {
    if (!this.snap) return null;
    let best: SnapUnit | null = null;
    let bd = 22 * 22;
    const s = this.renderer.camera.scale.x;
    for (const u of this.snap.units) {
      if (u.s !== this.side) continue;
      const p = this.renderer.unitPos(u.id) ?? u;
      const q = this.renderer.worldToScreen(p.x, p.y);
      const cy = q.y - (STATS[u.k].vehicle ? 8 : 12) * s;
      const d = (q.x - sx) ** 2 + (cy - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean) {
    if (!this.snap) return;
    if (!add) this.renderer.selected.clear();
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    for (const u of this.snap.units) {
      if (u.s !== this.side) continue;
      const p = this.renderer.unitPos(u.id) ?? u;
      const q = this.renderer.worldToScreen(p.x, p.y);
      if (q.x >= ax && q.x <= bx && q.y >= ay && q.y <= by + 10) this.renderer.selected.add(u.id);
    }
  }

  // ------------------------------------------------------------------ input

  private setupInput() {
    const canvas = this.renderer.app.canvas;
    const rect = $('selrect');
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'playing') return;
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 2) {
        this.moveSelected(e.offsetX, e.offsetY);
      } else if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this.panLast = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      } else if (e.button === 0) {
        this.selStart = { x: e.offsetX, y: e.offsetY };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.panLast) {
        this.renderer.pan(e.clientX - this.panLast.x, e.clientY - this.panLast.y);
        this.panLast = { x: e.clientX, y: e.clientY };
      } else if (this.selStart) {
        const x = Math.min(this.selStart.x, e.offsetX);
        const y = Math.min(this.selStart.y, e.offsetY);
        const w = Math.abs(e.offsetX - this.selStart.x);
        const h = Math.abs(e.offsetY - this.selStart.y);
        if (w + h > 6) {
          rect.hidden = false;
          Object.assign(rect.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
        }
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (this.panLast) {
        this.panLast = null;
        return;
      }
      if (!this.selStart) return;
      const s = this.selStart;
      this.selStart = null;
      rect.hidden = true;
      if (Math.abs(e.offsetX - s.x) + Math.abs(e.offsetY - s.y) > 6) {
        this.boxSelect(s.x, s.y, e.offsetX, e.offsetY, e.shiftKey);
      } else {
        const u = this.pick(e.offsetX, e.offsetY);
        if (!e.shiftKey) this.renderer.selected.clear();
        if (u) {
          if (e.shiftKey && this.renderer.selected.has(u.id)) this.renderer.selected.delete(u.id);
          else this.renderer.selected.add(u.id);
        }
      }
      if (this.renderer.selected.size > 0) this.audio.click();
      if (this.snap) this.updateSelectionPanel(this.snap);
    });
    canvas.addEventListener('dblclick', (e) => {
      if (this.mode !== 'playing' || !this.snap) return;
      const u = this.pick(e.offsetX, e.offsetY);
      if (!u) return;
      const r = this.renderer.app.screen;
      this.boxSelect(0, 0, r.width, r.height, false);
      for (const id of [...this.renderer.selected]) {
        const o = this.snap.units.find((x) => x.id === id);
        if (!o || o.k !== u.k) this.renderer.selected.delete(id);
      }
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
        if (e.ctrlKey || mouseWheel) this.renderer.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.offsetX, e.offsetY);
        else this.renderer.pan(-e.deltaX, -e.deltaY);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (this.mode !== 'playing') return;
      const k = e.key;
      this.keys.add(k);
      if (k === ' ') {
        e.preventDefault();
        this.togglePause();
      } else if (k === 'm' || k === 'M') this.setMusic(!this.audio.musicOn);
      else if (k === 'h' || k === 'H') this.toggleHelp();
      else if (k === ',') this.rotateView(-1);
      else if (k === '.') this.rotateView(1);
      else if (k === 'Escape') {
        this.renderer.selected.clear();
        $('helpbox').hidden = true;
      } else if (k === '+' || k === '=') this.renderer.zoomAt(1.2, this.renderer.app.screen.width / 2, this.renderer.app.screen.height / 2);
      else if (k === '-') this.renderer.zoomAt(1 / 1.2, this.renderer.app.screen.width / 2, this.renderer.app.screen.height / 2);
      else if (/^[1-9]$/.test(k)) {
        const n = Number(k);
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.groups.set(n, [...this.renderer.selected]);
        } else {
          const ids = (this.groups.get(n) ?? []).filter((id) => this.snap?.units.some((u) => u.id === id));
          this.renderer.selected = new Set(ids);
          const now = performance.now();
          if (this.lastGroupKey.n === n && now - this.lastGroupKey.t < 400 && ids.length) {
            const p = this.renderer.unitPos(ids[0]);
            if (p) this.renderer.centerOn(p.x, p.y);
          }
          this.lastGroupKey = { n, t: now };
        }
      } else {
        const hk = Object.entries(T.hotkeys).find(([, v]) => v.toLowerCase() === k.toLowerCase());
        if (hk) this.ability(hk[0] as Ability);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private tick(dt: number) {
    const sp = dt * 0.6;
    if (this.keys.has('ArrowLeft')) this.renderer.pan(sp, 0);
    if (this.keys.has('ArrowRight')) this.renderer.pan(-sp, 0);
    if (this.keys.has('ArrowUp')) this.renderer.pan(0, sp);
    if (this.keys.has('ArrowDown')) this.renderer.pan(0, -sp);
    if (this.mode === 'attract') {
      this.attractT += dt / 1000;
      const x = 32 + Math.cos(this.attractT * 0.05) * 12;
      const y = 32 + Math.sin(this.attractT * 0.05) * 12;
      this.renderer.centerOn(x, y);
    }
  }

  // ------------------------------------------------------------------ test hooks

  private exposeTestHooks() {
    (window as any).__sa = {
      game: this,
      mode: () => this.mode,
      snapshot: () => this.snap,
      selected: () => [...this.renderer.selected],
      unitScreen: (id: number) => {
        const p = this.renderer.unitPos(id);
        return p ? this.renderer.worldToScreen(p.x, p.y) : null;
      },
      tileScreen: (x: number, y: number) => this.renderer.worldToScreen(x + 0.5, y + 0.5),
      centerOn: (x: number, y: number) => this.renderer.centerOn(x, y),
      audioState: () => this.audio.ctx?.state ?? 'none',
      track: () => this.audio.current,
    };
    if (new URLSearchParams(location.search).has('debug')) {
      (window as any).__sa.setOpinion = (v: number) => this.post({ type: 'debug', opinion: v });
      (window as any).__sa.fastForward = (ticks: number) => this.post({ type: 'debug', ticks });
    }
  }
}
