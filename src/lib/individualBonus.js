export function calculateIndividualOfficialScore({
  grossToPar,
  holesPlayed,
  approvedBonuses,
}) {
  const grossScore = Number(grossToPar);
  const completedHoles = Number(holesPlayed);

  const bonusStrokes = (approvedBonuses ?? []).reduce(
    (total, bonus) => {
      const strokes = Number(bonus.bonus_strokes);
      return Number.isFinite(strokes) ? total + strokes : total;
    },
    0
  );

  const hasCompletedRound = completedHoles === 18;
  const appliedBonus = hasCompletedRound ? bonusStrokes : 0;
  const officialToPar = Number.isFinite(grossScore)
    ? grossScore - appliedBonus
    : null;

  return {
    holesPlayed: completedHoles,
    grossToPar: Number.isFinite(grossScore) ? grossScore : null,
    earnedBonus: bonusStrokes,
    appliedBonus,
    pendingBonus: bonusStrokes - appliedBonus,
    officialToPar,
    hasCompletedRound,
  };
}

export function groupBonusesByPlayer(approvedBonuses) {
  const bonusesByPlayer = new Map();

  (approvedBonuses ?? []).forEach((bonus) => {
    if (!bonus.player_id || bonus.approved !== true) return;

    const existingBonuses = bonusesByPlayer.get(bonus.player_id) ?? [];
    existingBonuses.push(bonus);
    bonusesByPlayer.set(bonus.player_id, existingBonuses);
  });

  return bonusesByPlayer;
}

export function applyIndividualBonuses({
  leaderboard,
  approvedBonuses,
}) {
  const bonusesByPlayer = groupBonusesByPlayer(approvedBonuses);

  return (leaderboard ?? []).map((player) => {
    const playerBonuses = bonusesByPlayer.get(player.playerId) ?? [];

    const officialScore = calculateIndividualOfficialScore({
      grossToPar: player.scoreToPar,
      holesPlayed: player.holesPlayed,
      approvedBonuses: playerBonuses,
    });

    return {
      ...player,
      approvedBonuses: playerBonuses,
      earnedBonus: officialScore.earnedBonus,
      appliedBonus: officialScore.appliedBonus,
      pendingBonus: officialScore.pendingBonus,
      officialToPar: officialScore.officialToPar,
      hasCompletedRound: officialScore.hasCompletedRound,
    };
  });
}

export function sortIndividualLeaderboard(leaderboard) {
  return [...(leaderboard ?? [])].sort((a, b) => {
    if (a.holesPlayed !== b.holesPlayed) {
      return b.holesPlayed - a.holesPlayed;
    }

    const aScore = a.officialToPar ?? Infinity;
    const bScore = b.officialToPar ?? Infinity;

    if (aScore !== bScore) return aScore - bScore;

    return a.playerName.localeCompare(b.playerName, "da");
  });
}
