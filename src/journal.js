import { controls } from './controls';
import { spaceAudio } from './audio';
import { sfx } from './sfx';
import { CHAPTERS } from './storyline';
import { CREW_DEFS, CREW_KEYS } from './crew';
import { ENDINGS } from './story';
import { displayName } from './names';

// The journal (J): everything there is to do, and where. The main story (or who waits for you where), running
// jobs, what the crew wants, side stories. Each entry with a place can set the course there: click it or press its
// number; X then jumps. Opened in flight it pauses the game like the logbook; docked, the course is set for undocking.

const fmt = (n) => Math.round(n).toLocaleString('de-DE');

function fmtDist(d) {
  const km = d * 100000;
  if (km > 149600000) return `${(km / 149597870.7).toFixed(1).replace('.', ',')} AE`;
  if (km > 1e6) return `${(km / 1e6).toFixed(1).replace('.', ',')} Mio. km`;
  return `${fmt(km)} km`;
}

const posOf = (o) => (o.group ? o.group.position : o.mesh ? o.mesh.position : o.pos);

export class Journal {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('journal-screen');
    this.body = document.getElementById('journal-body');
    this.isOpen = false;
    this.actions = [];
    document.getElementById('journal-close').addEventListener('click', () => this.close());
    this.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-jact]');
      if (b) this.run(Number(b.dataset.jact));
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      const n = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      if (n) { e.preventDefault(); e.stopPropagation(); this.run(Number(n[2]) - 1); }
    }, true);
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    const g = this.game;
    if (!g.simRunning || g.ship.isDestroyed || g.ui.pauseOpen || g.ui.navMap.isOpen || g.photo.active) return;
    this.isOpen = true;
    this.docked = g.ship.isDocked;
    if (!this.docked) g.paused = true;
    this.render();
    this.el.classList.remove('hidden');
    if (!this.docked) document.exitPointerLock();
    spaceAudio.playBeep();
  }

  close() {
    if (!this.isOpen) return;
    const g = this.game;
    this.isOpen = false;
    this.el.classList.add('hidden');
    if (!this.docked) {
      g.paused = false;
      g.clock.getDelta();
      controls.requestLock();
    }
  }

  // ----- what to show --------------------------------------------------------------------------------

  station(name) {
    return this.game.solarSystem.stations.find((s) => s.name === name);
  }

  dist(obj) {
    const p = obj && posOf(obj);
    return p ? fmtDist(p.distanceTo(this.game.ship.position)) : '';
  }

  sections() {
    const g = this.game;
    const { missions, story, crew, rival } = g;
    const out = [];

    // The main story
    const main = [];
    const storyMission = missions.active.find((m) => m.type === 'story');
    if (storyMission) {
      main.push(this.missionEntry(storyMission, 'Hauptauftrag'));
    } else if (missions.open.length) {
      const choice = missions.open.length > 1;
      missions.open.forEach((id) => {
        const ch = CHAPTERS[id];
        const st = missions.field(ch, 'station');
        const giver = missions.field(ch, 'giver');
        const room = missions.field(ch, 'room') || (giver.faction === 'police' ? 'office' : 'bar');
        const where = room === 'office' ? (this.station(st).def.blackMarket ? 'beim Mittelsmann' : 'im SOLPOL-Revier') : 'in der Bar';
        main.push({
          title: ch.title, tag: choice ? (ch.choice ? `Weg: ${ch.choice}` : 'Wahl') : 'Hauptgeschichte',
          sub: `${giver.speaker} wartet ${where} · ${displayName(st)}`,
          target: this.station(st), label: displayName(st),
        });
      });
      if (choice) main.unshift({ note: 'Am Scheideweg: Wem du folgst, entscheidet, wie die Geschichte weitergeht. Hör dir alle an.' });
    } else if (story.ending) {
      main.push({ note: `Die Geschichte ist erzählt: ${ENDINGS[story.ending].title}. Das System gehört dir, im Freiflug.` });
    }
    out.push({ title: 'Hauptgeschichte', items: main });

    // Running jobs
    const jobs = missions.active.filter((m) => m.type !== 'story').map((m) => this.missionEntry(m, m.type === 'side' ? 'Nebengeschichte' : 'Auftrag'));
    out.push({ title: `Laufende Aufträge (${jobs.length} / 4)`, items: jobs.length ? jobs : [{ note: 'Keine. Das Auftragsbüro jeder Station hat Arbeit, die Bars manchmal auch.' }] });

    // The crew: favours to ask, trust still to earn, people looking for work
    const people = [];
    crew.list().forEach((id) => {
      const def = CREW_DEFS[id];
      const l = Math.round(crew.loyalty(id));
      const done = missions.sideDone.includes(def.quest) || missions.active.some((m) => m.quest === def.quest);
      if (done) return;
      if (crew.questReady(id) && l >= def.questAt) {
        people.push({ title: `${def.name} möchte mit dir reden`, tag: 'Crew', sub: `An Bord: U zum Aufstehen, dann zu ${id === 'jo' ? 'ihr' : 'ihm'} gehen und E drücken.` });
      } else if (crew.questReady(id)) {
        people.push({ title: `${def.name} vertraut dir noch nicht ganz`, tag: 'Crew', sub: `Loyalität ${l} / ${def.questAt}. Rede mit ${def.name.split(' ')[0]} an Bord und tu, was ${id === 'jo' ? 'ihr' : 'ihm'} gefällt.` });
      }
    });
    CREW_KEYS.forEach((id) => {
      const def = CREW_DEFS[id];
      if (!crew.canHire(id, def.station)) return;
      people.push({
        title: `${def.name}, ${def.title}, sucht Arbeit`, tag: 'Anheuern',
        sub: `In der Bar · ${displayName(def.station)} · ${def.cost ? `${fmt(def.cost)} Cr` : 'kostenlos'}. ${def.bonus}`,
        target: this.station(def.station), label: displayName(def.station),
      });
    });
    if (people.length) out.push({ title: 'Crew', items: people });

    // Side stories
    const side = [];
    const vargaReady = (missions.done.includes('uniformen') || story.has('kranich_log')) && missions.sideOffer('sonde');
    if (story.has('signal_kern') && !story.has('signal_entschieden')) {
      side.push({ title: 'Dr. Varga hat den Speicherkern ausgelesen', tag: 'Das Signal', sub: 'Sie wartet in der Bar · Europa-Station', target: this.station('Europa-Station'), label: 'Europa-Station' });
    } else if (vargaReady) {
      side.push({ title: 'Ein Signal hinter Neptun', tag: 'Das Signal', sub: 'Dr. Ilse Varga sucht einen Piloten · Bar, Europa-Station', target: this.station('Europa-Station'), label: 'Europa-Station' });
    }
    if (!rival.done && rival.round > 0) side.push({ title: 'Der Geier ist dir auf den Fersen', tag: 'Rivale', sub: `Er ist dir ${rival.round}× entkommen und kommt wieder, wo SOLPOL selten ist.` });
    if (this.game.discovered.has('Hades-Nest') === false && missions.done.includes('notruf') && !story.path) {
      side.push({ title: 'Das Hades-Nest', tag: 'Gerücht', sub: 'Ein Mann mit Brandnarbe auf dem Triton-Posten verkauft die Koordinaten.', target: this.station('Triton-Posten'), label: 'Triton-Posten' });
    }
    if (side.length) out.push({ title: 'Nebengeschichten', items: side });
    return out;
  }

  missionEntry(m, tag) {
    const { missions } = this.game;
    const obj = missions.current(m);
    const dest = missions.destination(m);
    return {
      title: m.title, tag: missions.tracked === m ? `${tag} · verfolgt` : tag,
      sub: `${obj ? obj.label : 'Abgeschlossen'}${m.reward ? ` · ${fmt(m.reward)} Cr` : ''}`,
      target: dest, mission: m, label: dest ? (dest.name ? displayName(dest.name) : 'Navpunkt') : null,
    };
  }

  render() {
    this.actions = [];
    const html = this.sections().map((sec) => {
      const items = sec.items.map((it) => {
        if (it.note) return `<p class="journal-note">${it.note}</p>`;
        let btn = '';
        if (it.target) {
          this.actions.push(it);
          const n = this.actions.length;
          btn = `<button class="shop-action-btn journal-go" data-jact="${n - 1}">${n <= 9 ? `[${n}] ` : ''}Kurs setzen</button>`;
        }
        const dist = it.target ? `<span class="journal-dist">${it.label ? `${it.label} · ` : ''}${this.dist(it.target)}</span>` : '';
        return `<div class="journal-entry ${it.mission && this.game.missions.tracked === it.mission ? 'tracked' : ''}">
          <div><span class="journal-tag">${it.tag || ''}</span><b>${it.title}</b><p>${it.sub || ''}</p>${dist}</div>${btn}</div>`;
      }).join('') || '<p class="journal-note">Nichts.</p>';
      return `<section><h3 class="section">${sec.title}</h3>${items}</section>`;
    }).join('');
    this.body.innerHTML = html;
  }

  // Set the course: the tracked mission and the ship's target; X then jumps
  run(i) {
    const it = this.actions[i];
    if (!it) { sfx.denied(); return; }
    const g = this.game;
    if (it.mission) g.missions.tracked = it.mission;
    if (g.ship.isDocked) g.pendingTarget = it.target;
    else g.setTarget(it.target);
    spaceAudio.playBeep();
    this.close();
    const name = it.label || it.title;
    g.hud.toast(g.ship.isDocked ? `Kurs gesetzt: ${name}. Nach dem Ablegen springt X hin.` : `Kurs gesetzt: ${name} · [X] springt hin`, 'info');
  }
}
