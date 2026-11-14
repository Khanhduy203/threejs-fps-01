// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, the
// minimap, the kill feed, the buy menu and the overlays. It never touches the
// simulation; main.js pushes numbers in, and every setter writes the DOM only
// when its value changed. The minimap is a 2D canvas redrawn at 10 Hz.
import { SHOP } from './economy.js';

const COPY = {
  start: {
    title: 'SANDLINE',
    copy: 'Depot 9, dusk. STRIKE attacks, WARDEN defends. Plant the bomb at A or B, or wipe the defence out — first to 5 rounds takes the match.',
    action: 'Deploy',
  },
  paused: {
    title: 'SANDLINE',
    copy: 'Paused. Your team holds position.',
    action: 'Resume',
  },
  matchEnd: {
    title: '',
    copy: '',
    action: 'Play again',
  },
};

export function createHud(callbacks) {
  const el = (id) => document.getElementById(id);
  const overlay = el('overlay');
  const overlayTitle = el('overlay-title');
  const overlayCopy = el('overlay-copy');
  const playButton = el('play');
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const healthValue = el('health-value');
  const healthBar = el('health-bar');
  const armourValue = el('armour-value');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const weaponName = el('weapon-name');
  const reloadHint = el('reload-hint');
  const moneyValue = el('money-value');
  const grenadeValue = el('grenade-value');
  const timerValue = el('timer-value');
  const timerLabel = el('timer-label');
  const scoreStrike = el('score-strike');
  const scoreWarden = el('score-warden');
  const roundValue = el('round-value');
  const pipsStrike = el('pips-strike');
  const pipsWarden = el('pips-warden');
  const teammates = el('teammates');
  const feedList = el('feed');
  const announceBox = el('announce');
  const announceTitle = el('announce-title');
  const announceSub = el('announce-sub');
  const progressWrap = el('progress-wrap');
  const progressLabel = el('progress-label');
  const progressBar = el('progress-bar');
  const bombStatus = el('bomb-status');
  const vignette = el('vignette');
  const damageDir = el('damage-dir');
  const deathNotice = el('death-notice');
  const scopeOverlay = el('scope');
  const buyMenu = el('buy-menu');
  const buyMoney = el('buy-money');
  const buyRows = el('buy-rows');
  const buyNote = el('buy-note');
  const hintBar = el('hint-bar');
  const minimap = el('minimap');
  const mapCtx = minimap.getContext('2d');

  let last = {};
  let hitTimer = 0;
  let announceTimer = 0;
  let vignetteTimer = 0;

  function setText(node, value, key) {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  }

  // The buy menu rows are built once from the shop list; clicks and number
  // keys both go through callbacks.onBuy.
  for (const item of SHOP) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'buy-row';
    row.dataset.item = item.id;
    row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-item"><b>${item.name}</b><i>${item.detail}</i></span><span class="buy-price">$${item.price}</span>`;
    row.addEventListener('click', () => callbacks.onBuy(item.id));
    buyRows.appendChild(row);
  }
  el('deploy').addEventListener('click', () => callbacks.onDeploy());
  playButton.addEventListener('click', () => callbacks.onPlay());

  function refreshBuy(money, ownedIds, grenades, armour) {
    setText(buyMoney, `$${money}`, 'buyMoney');
    for (const row of buyRows.children) {
      const item = SHOP.find((entry) => entry.id === row.dataset.item);
      let disabled = money < item.price;
      let note = '';
      if (item.id === 'grenade' && grenades >= 2) {
        disabled = true;
        note = 'MAX';
      }
      if (item.id === 'armour' && armour >= 100) {
        disabled = true;
        note = 'FULL';
      }
      if (ownedIds.includes(item.id)) {
        disabled = true;
        note = 'OWNED';
      }
      row.classList.toggle('disabled', disabled);
      row.querySelector('.buy-price').textContent = note || `$${item.price}`;
    }
  }

  function setPips(node, alive, total, key) {
    const value = `${alive}/${total}`;
    if (last[key] === value) return;
    last[key] = value;
    node.innerHTML = '';
    for (let i = 0; i < total; i += 1) {
      const pip = document.createElement('i');
      if (i < alive) pip.className = 'alive';
      node.appendChild(pip);
    }
  }

  return {
    setHealth(health, armour) {
      setText(healthValue, String(Math.ceil(health)), 'health');
      if (last.healthBar !== health) {
        last.healthBar = health;
        healthBar.style.width = `${Math.max(0, health)}%`;
        healthBar.classList.toggle('low', health <= 30);
      }
      setText(armourValue, armour > 0 ? `+${armour}` : '', 'armour');
    },
    setAmmo(mag, reserve, name, reloading) {
      setText(ammoMag, String(mag), 'mag');
      setText(ammoReserve, `/ ${reserve}`, 'reserve');
      setText(weaponName, name, 'weaponName');
      const show = mag === 0 && reserve > 0;
      if (last.reloadHint !== show) {
        last.reloadHint = show;
        reloadHint.hidden = !show;
      }
      el('ammo').classList.toggle('empty', mag === 0);
      el('ammo').classList.toggle('reloading', reloading);
    },
    setMoney(money) {
      setText(moneyValue, `$${money}`, 'money');
    },
    setGrenades(count) {
      setText(grenadeValue, count > 0 ? `◉ ${count}` : '', 'grenades');
    },
    setTimer(seconds, label) {
      const total = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
      setText(timerValue, text, 'timer');
      setText(timerLabel, label, 'timerLabel');
      timerValue.classList.toggle('urgent', label === 'BOMB' || total <= 10);
    },
    setScore(strike, warden, round, maxRounds) {
      setText(scoreStrike, String(strike), 'scoreS');
      setText(scoreWarden, String(warden), 'scoreW');
      setText(roundValue, `ROUND ${round}/${maxRounds}`, 'round');
    },
    setPips(strikeAlive, wardenAlive) {
      setPips(pipsStrike, strikeAlive, 3, 'pipsS');
      setPips(pipsWarden, wardenAlive, 3, 'pipsW');
    },
    setTeammates(members) {
      const key = members.map((m) => `${m.name}:${Math.ceil(m.health)}:${m.alive ? 1 : 0}`).join('|');
      if (last.teammates === key) return;
      last.teammates = key;
      teammates.innerHTML = '';
      for (const m of members) {
        const row = document.createElement('div');
        row.className = `mate${m.alive ? '' : ' dead'}`;
        row.innerHTML = `<span>${m.name}</span><span class="mate-bar"><i style="width:${Math.max(0, m.health)}%"></i></span><b>${m.alive ? Math.ceil(m.health) : '✕'}</b>`;
        teammates.appendChild(row);
      }
    },
    setBombStatus(text) {
      setText(bombStatus, text, 'bombStatus');
    },
    setHint(text) {
      setText(hintBar, text, 'hint');
    },
    setCrosshair(spreadPx, aiming, sniper) {
      const gap = Math.round(Math.min(42, Math.max(5, 5 + spreadPx)));
      if (last.gap !== gap) {
        last.gap = gap;
        crosshair.style.setProperty('--gap', `${gap}px`);
      }
      crosshair.classList.toggle('hidden', aiming && sniper);
      scopeOverlay.hidden = !(aiming && sniper);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFrom(angleRad) {
      vignette.classList.add('on');
      clearTimeout(vignetteTimer);
      vignetteTimer = setTimeout(() => vignette.classList.remove('on'), 220);
      damageDir.style.transform = `translate(-50%, -50%) rotate(${angleRad}rad)`;
      damageDir.classList.add('on');
      setTimeout(() => damageDir.classList.remove('on'), 500);
    },
    setDead(dead, spectatorName) {
      deathNotice.hidden = !dead;
      if (dead) setText(el('death-text'), `You are down — ${spectatorName} still fights.`, 'deathText');
    },
    announce(text, sub) {
      announceTitle.textContent = text;
      announceSub.textContent = sub;
      announceBox.classList.add('on');
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => announceBox.classList.remove('on'), 3200);
    },
    renderFeed(feed) {
      feedList.innerHTML = '';
      for (let i = feed.length - 1; i >= 0; i -= 1) {
        const entry = document.createElement('div');
        entry.className = feed[i].good ? 'good' : 'bad';
        entry.textContent = feed[i].text;
        feedList.appendChild(entry);
      }
    },
    setProgress(label, fraction) {
      if (fraction <= 0) {
        progressWrap.hidden = true;
        return;
      }
      progressWrap.hidden = false;
      setText(progressLabel, label, 'progressLabel');
      progressBar.style.width = `${Math.round(fraction * 100)}%`;
    },
    showBuy(show) {
      buyMenu.hidden = !show;
    },
    refreshBuy,
    setBuyNote(text) {
      setText(buyNote, text, 'buyNote');
    },
    showOverlay(mode, data = {}) {
      const text = COPY[mode];
      if (mode === 'matchEnd') {
        overlayTitle.textContent = data.title;
        overlayCopy.textContent = data.copy;
      } else {
        overlayTitle.textContent = text.title;
        overlayCopy.textContent = text.copy;
      }
      playButton.textContent = text.action;
      overlay.hidden = false;
      playButton.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    drawMinimap(world, player, bots, state) {
      const W = minimap.width;
      const H = minimap.height;
      const scaleX = W / 64;
      const scaleY = H / 48;
      const toX = (x) => (x + 32) * scaleX;
      const toY = (z) => (z + 24) * scaleY;
      mapCtx.fillStyle = 'rgba(20, 18, 14, 0.85)';
      mapCtx.fillRect(0, 0, W, H);
      mapCtx.fillStyle = '#6b5d45';
      for (const [x, z, w, d] of world.minimapWalls) {
        mapCtx.fillRect(toX(x - w / 2), toY(z - d / 2), Math.max(1, w * scaleX), Math.max(1, d * scaleY));
      }
      mapCtx.font = 'bold 11px system-ui, sans-serif';
      mapCtx.textAlign = 'center';
      mapCtx.textBaseline = 'middle';
      for (const [letter, site] of [['A', { x: -24, z: -14 }], ['B', { x: 24, z: -14 }]]) {
        mapCtx.fillStyle = state.bomb.state === 'planted' && state.bomb.site === letter ? '#ff3b30' : '#e8862e';
        mapCtx.fillText(letter, toX(site.x), toY(site.z));
      }
      const dot = (x, z, color, radius = 3) => {
        mapCtx.fillStyle = color;
        mapCtx.beginPath();
        mapCtx.arc(toX(x), toY(z), radius, 0, Math.PI * 2);
        mapCtx.fill();
      };
      // Spotted enemies fade after 3 seconds.
      for (const [id, at] of state.spotted) {
        if (state.elapsed - at > 3) continue;
        const bot = bots.find((b) => b.id === id);
        if (bot && bot.alive) dot(bot.position.x, bot.position.z, '#ff5a4d', 3);
      }
      for (const bot of bots) {
        if (!bot.alive) continue;
        if (bot.team === 0) dot(bot.position.x, bot.position.z, '#37b6a0', 3);
      }
      if (state.bomb.state === 'dropped' || state.bomb.state === 'planted') {
        mapCtx.fillStyle = '#ffd23c';
        const bx = toX(state.bomb.x);
        const by = toY(state.bomb.z);
        mapCtx.save();
        mapCtx.translate(bx, by);
        mapCtx.rotate(Math.PI / 4);
        mapCtx.fillRect(-3, -3, 6, 6);
        mapCtx.restore();
      }
      // The player: a wedge rotated to the view yaw.
      mapCtx.save();
      mapCtx.translate(toX(player.position.x), toY(player.position.z));
      mapCtx.rotate(-player.yaw + Math.PI);
      mapCtx.fillStyle = '#ffffff';
      mapCtx.beginPath();
      mapCtx.moveTo(0, -6);
      mapCtx.lineTo(4.5, 5);
      mapCtx.lineTo(-4.5, 5);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.restore();
    },
  };
}
