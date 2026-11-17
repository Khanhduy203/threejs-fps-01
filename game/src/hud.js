// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, the
// minimap, the kill feed, the buy menu and the overlays. It never touches the
// simulation; main.js pushes numbers in, and every setter writes the DOM only
// when its value changed. The minimap is a 2D canvas redrawn at 10 Hz.
import { SHOP } from './economy.js';

// Overlay copy, as [mode, title, body, button] rows; the match-end screen
// fills its title and body in from the result instead.
const OVERLAY_COPY = [
  [
    'start',
    'SANDLINE',
    'Depot 9, dusk. STRIKE attacks, WARDEN defends. Plant the bomb at A or B, or wipe the defence out — first to 5 rounds takes the match.',
    'Deploy',
  ],
  ['paused', 'SANDLINE', 'Paused. Your team holds position.', 'Resume'],
  ['matchEnd', '', '', 'Play again'],
];
const COPY = {};
for (const [mode, title, copy, action] of OVERLAY_COPY) COPY[mode] = { title, copy, action };

export function createHud(callbacks) {
  const ids = [
    'overlay', 'overlay-title', 'overlay-copy', 'play', 'crosshair', 'hitmarker',
    'health-value', 'health-bar', 'armour-value', 'ammo-mag', 'ammo-reserve',
    'weapon-name', 'reload-hint', 'money-value', 'grenade-value', 'timer-value',
    'timer-label', 'score-strike', 'score-warden', 'round-value', 'pips-strike',
    'pips-warden', 'teammates', 'feed', 'announce', 'announce-title', 'announce-sub',
    'progress-wrap', 'progress-label', 'progress-bar', 'bomb-status', 'vignette',
    'damage-dir', 'death-notice', 'scope', 'buy-menu', 'buy-money', 'buy-rows',
    'buy-note', 'hint-bar', 'minimap', 'hud',
  ];
  const nodes = {};
  for (const id of ids) nodes[id] = document.getElementById(id);
  const mapCtx = nodes.minimap.getContext('2d');

  const seen = {};
  let hitTimer = 0;
  let announceTimer = 0;
  let vignetteTimer = 0;

  function setText(node, value, key) {
    if (seen[key] === value) return;
    seen[key] = value;
    node.textContent = value;
  }

  // The buy menu rows are built once from the shop list; clicks and number
  // keys both go through callbacks.onBuy.
  for (const item of SHOP) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'buy-row';
    row.dataset.item = item.id;
    const key = document.createElement('span');
    key.className = 'buy-key';
    key.textContent = item.key;
    const label = document.createElement('span');
    label.className = 'buy-item';
    const name = document.createElement('b');
    name.textContent = item.name;
    const detail = document.createElement('i');
    detail.textContent = item.detail;
    label.append(name, detail);
    const price = document.createElement('span');
    price.className = 'buy-price';
    price.textContent = `$${item.price}`;
    row.append(key, label, price);
    row.addEventListener('click', () => callbacks.onBuy(item.id));
    nodes['buy-rows'].appendChild(row);
  }
  document.getElementById('deploy').addEventListener('click', () => callbacks.onDeploy());
  nodes.play.addEventListener('click', () => callbacks.onPlay());

  function refreshBuy(money, ownedIds, grenades, armour) {
    setText(nodes['buy-money'], `$${money}`, 'buyMoney');
    for (const row of nodes['buy-rows'].children) {
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

  function paintPips(node, alive, total, key) {
    const value = `${alive}/${total}`;
    if (seen[key] === value) return;
    seen[key] = value;
    node.innerHTML = '';
    for (let i = 0; i < total; i += 1) {
      const pip = document.createElement('i');
      if (i < alive) pip.className = 'alive';
      node.appendChild(pip);
    }
  }

  function teammateRow(member) {
    const row = document.createElement('div');
    row.className = `mate${member.alive ? '' : ' dead'}`;
    const name = document.createElement('span');
    name.textContent = member.name;
    const track = document.createElement('span');
    track.className = 'mate-bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(0, member.health)}%`;
    track.appendChild(fill);
    const hp = document.createElement('b');
    hp.textContent = member.alive ? String(Math.ceil(member.health)) : '✕';
    row.append(name, track, hp);
    return row;
  }

  return {
    // The menu and match-end screens stand alone; the HUD hides behind them.
    setVisible(visible) {
      if (seen.visible === visible) return;
      seen.visible = visible;
      nodes.hud.style.visibility = visible ? 'visible' : 'hidden';
    },
    setHealth(health, armour) {
      setText(nodes['health-value'], String(Math.ceil(health)), 'health');
      if (seen.healthBar !== health) {
        seen.healthBar = health;
        nodes['health-bar'].style.width = `${Math.max(0, health)}%`;
        nodes['health-bar'].classList.toggle('low', health <= 30);
      }
      setText(nodes['armour-value'], armour > 0 ? `+${armour}` : '', 'armour');
    },
    setAmmo(mag, reserve, name, reloading) {
      setText(nodes['ammo-mag'], String(mag), 'mag');
      setText(nodes['ammo-reserve'], `/ ${reserve}`, 'reserve');
      setText(nodes['weapon-name'], name, 'weaponName');
      const show = mag === 0 && reserve > 0;
      if (seen.reloadHint !== show) {
        seen.reloadHint = show;
        nodes['reload-hint'].hidden = !show;
      }
      const ammoBlock = document.getElementById('ammo');
      ammoBlock.classList.toggle('empty', mag === 0);
      ammoBlock.classList.toggle('reloading', reloading);
    },
    setMoney(money) {
      setText(nodes['money-value'], `$${money}`, 'money');
    },
    setGrenades(count) {
      setText(nodes['grenade-value'], count > 0 ? `◉ ${count}` : '', 'grenades');
    },
    setTimer(seconds, label) {
      const total = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
      setText(nodes['timer-value'], text, 'timer');
      setText(nodes['timer-label'], label, 'timerLabel');
      nodes['timer-value'].classList.toggle('urgent', label === 'BOMB' || total <= 10);
    },
    setScore(strike, warden, round, maxRounds) {
      setText(nodes['score-strike'], String(strike), 'scoreS');
      setText(nodes['score-warden'], String(warden), 'scoreW');
      setText(nodes['round-value'], `ROUND ${round}/${maxRounds}`, 'round');
    },
    setPips(strikeAlive, wardenAlive) {
      paintPips(nodes['pips-strike'], strikeAlive, 3, 'pipsS');
      paintPips(nodes['pips-warden'], wardenAlive, 3, 'pipsW');
    },
    setTeammates(members) {
      const key = members.map((m) => `${m.name}:${Math.ceil(m.health)}:${m.alive ? 1 : 0}`).join('|');
      if (seen.teammates === key) return;
      seen.teammates = key;
      nodes.teammates.innerHTML = '';
      for (const m of members) nodes.teammates.appendChild(teammateRow(m));
    },
    setBombStatus(text) {
      setText(nodes['bomb-status'], text, 'bombStatus');
    },
    setHint(text) {
      setText(nodes['hint-bar'], text, 'hint');
    },
    setCrosshair(spreadPx, aiming, sniper) {
      const gap = Math.round(Math.min(42, Math.max(5, 5 + spreadPx)));
      if (seen.gap !== gap) {
        seen.gap = gap;
        nodes.crosshair.style.setProperty('--gap', `${gap}px`);
      }
      nodes.crosshair.classList.toggle('hidden', aiming && sniper);
      nodes.scope.hidden = !(aiming && sniper);
    },
    hitMarker(killed, holdMs = 90) {
      nodes.hitmarker.classList.add('on');
      nodes.hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => nodes.hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFrom(angleRad) {
      nodes.vignette.classList.add('on');
      clearTimeout(vignetteTimer);
      vignetteTimer = setTimeout(() => nodes.vignette.classList.remove('on'), 220);
      nodes['damage-dir'].style.transform = `translate(-50%, -50%) rotate(${angleRad}rad)`;
      nodes['damage-dir'].classList.add('on');
      setTimeout(() => nodes['damage-dir'].classList.remove('on'), 500);
    },
    setDead(dead, spectatorName) {
      nodes['death-notice'].hidden = !dead;
      if (dead) setText(document.getElementById('death-text'), `You are down — ${spectatorName} still fights.`, 'deathText');
    },
    announce(text, sub) {
      nodes['announce-title'].textContent = text;
      nodes['announce-sub'].textContent = sub;
      nodes.announce.classList.add('on');
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => nodes.announce.classList.remove('on'), 3200);
    },
    renderFeed(feed) {
      nodes.feed.innerHTML = '';
      for (let i = feed.length - 1; i >= 0; i -= 1) {
        const entry = document.createElement('div');
        entry.className = feed[i].good ? 'good' : 'bad';
        entry.textContent = feed[i].text;
        nodes.feed.appendChild(entry);
      }
    },
    setProgress(label, fraction) {
      if (fraction <= 0) {
        nodes['progress-wrap'].hidden = true;
        return;
      }
      nodes['progress-wrap'].hidden = false;
      setText(nodes['progress-label'], label, 'progressLabel');
      nodes['progress-bar'].style.width = `${Math.round(fraction * 100)}%`;
    },
    showBuy(show) {
      nodes['buy-menu'].hidden = !show;
    },
    refreshBuy,
    setBuyNote(text) {
      setText(nodes['buy-note'], text, 'buyNote');
    },
    showOverlay(mode, data = {}) {
      const text = COPY[mode];
      if (mode === 'matchEnd') {
        nodes['overlay-title'].textContent = data.title;
        nodes['overlay-copy'].textContent = data.copy;
      } else {
        nodes['overlay-title'].textContent = text.title;
        nodes['overlay-copy'].textContent = text.copy;
      }
      nodes.play.textContent = text.action;
      nodes.overlay.hidden = false;
      nodes.play.focus();
    },
    hideOverlay() {
      nodes.overlay.hidden = true;
    },
    drawMinimap(world, player, bots, state) {
      const W = nodes.minimap.width;
      const H = nodes.minimap.height;
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
      const siteMarks = [
        { letter: 'A', x: -24, z: -14 },
        { letter: 'B', x: 24, z: -14 },
      ];
      for (const mark of siteMarks) {
        mapCtx.fillStyle = state.bomb.state === 'planted' && state.bomb.site === mark.letter ? '#ff3b30' : '#e8862e';
        mapCtx.fillText(mark.letter, toX(mark.x), toY(mark.z));
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
