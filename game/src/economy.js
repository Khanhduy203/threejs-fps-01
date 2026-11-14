// The economy: money earned by kills and round results, spent in the buy menu
// during the buy phase. A survived round keeps the loadout, armour and grenades;
// a death drops everything but the sidearm. Prices and rewards are Counter-
// Strike-shaped: a rifle costs most of a round win, so losing rounds hurts.
import { ECONOMY } from './state.js';
import { WEAPONS } from './weapons.js';

export const SHOP = [
  { key: '1', id: 'smg', name: 'VK-9 Ripper', detail: 'SMG · fast, close range', price: WEAPONS.smg.price },
  { key: '2', id: 'rifle', name: 'AR-77 Carbine', detail: 'Rifle · the all-rounder', price: WEAPONS.rifle.price },
  { key: '3', id: 'sniper', name: 'LANCE-50', detail: 'Sniper · one shot, scoped', price: WEAPONS.sniper.price },
  { key: '4', id: 'grenade', name: 'Frag Grenade', detail: 'Throw with G · max 2', price: 300 },
  { key: '5', id: 'armour', name: 'Kevlar Vest', detail: 'Absorbs half of each hit', price: 650 },
  { key: '6', id: 'ammo', name: 'Ammo Resupply', detail: 'Refills every magazine', price: 200 },
];

export function createEconomy(state, weapons, player) {
  let kept = null; // loadout a survived round carries into the next one

  function canAfford(price) {
    return state.money >= price;
  }

  function buy(id) {
    const item = SHOP.find((entry) => entry.id === id);
    if (!item) return { ok: false, reason: 'No such item.' };
    if (state.phase !== 'buy') return { ok: false, reason: 'Buying is open only before the round starts.' };
    if (!canAfford(item.price)) return { ok: false, reason: 'Not enough money.' };
    if (id === 'grenade' && weapons.state.grenades >= 2) return { ok: false, reason: 'Carrying the maximum of 2 grenades.' };
    if (id === 'armour' && player.state.armour >= 100) return { ok: false, reason: 'Armour is already full.' };
    if ((id === 'smg' || id === 'rifle' || id === 'sniper') && weapons.owns(id)) {
      return { ok: false, reason: 'Already owned — use Ammo Resupply instead.' };
    }
    state.money -= item.price;
    if (id === 'grenade') weapons.state.grenades += 1;
    else if (id === 'armour') player.state.armour = 100;
    else if (id === 'ammo') weapons.refillAmmo();
    else weapons.buy(id);
    return { ok: true, reason: `${item.name} bought.` };
  }

  function killReward() {
    state.money = Math.min(ECONOMY.maxMoney, state.money + ECONOMY.killReward);
  }

  function roundReward(winnerTeam) {
    if (winnerTeam === 0) {
      state.money = Math.min(ECONOMY.maxMoney, state.money + ECONOMY.winReward);
      state.lossStreak = 0;
    } else {
      const bonus = Math.min(3, state.lossStreak) * ECONOMY.lossStreakBonus;
      state.money = Math.min(ECONOMY.maxMoney, state.money + ECONOMY.lossReward + bonus);
      state.lossStreak += 1;
    }
  }

  // Called at the round end: the living keep their kit, the dead lose it.
  function keepLoadout() {
    if (player.state.alive) {
      kept = {
        loadout: weapons.snapshotLoadout(),
        armour: player.state.armour,
        grenades: weapons.state.grenades,
      };
    } else {
      kept = null;
    }
  }

  function restoreLoadout() {
    if (kept) {
      weapons.resetRound(kept.loadout);
      player.state.armour = kept.armour;
      weapons.state.grenades = kept.grenades;
    } else {
      weapons.resetRound(null);
      weapons.state.grenades = 0;
    }
  }

  return { buy, killReward, roundReward, keepLoadout, restoreLoadout };
}
