function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function getHandicapStrokesOnHole(
  playingHandicap,
  strokeIndex
) {
  const handicap = Math.trunc(toNumber(playingHandicap));
  const index = Math.trunc(toNumber(strokeIndex));

  if (index < 1 || index > 18) {
    throw new Error(`Ugyldigt Stroke Index: ${strokeIndex}`);
  }

  if (handicap === 0) return 0;

  if (handicap > 0) {
    const fullRotations = Math.floor(handicap / 18);
    const remainingStrokes = handicap % 18;

    return fullRotations + (index <= remainingStrokes ? 1 : 0);
  }

  const strokesToGive = Math.abs(handicap);
  const fullRotations = Math.floor(strokesToGive / 18);
  const remainingStrokes = strokesToGive % 18;
  const givesExtraStroke =
    remainingStrokes > 0 && index > 18 - remainingStrokes;

  return -(fullRotations + (givesExtraStroke ? 1 : 0));
}

export function calculatePlayerNetHole({
  grossStrokes,
  par,
  strokeIndex,
  playingHandicap,
}) {
  if (
    grossStrokes === null ||
    grossStrokes === undefined ||
    grossStrokes === ""
  ) {
    return null;
  }

  const gross = toNumber(grossStrokes, NaN);
  const holePar = toNumber(par, NaN);

  if (!Number.isFinite(gross) || gross < 1) {
    throw new Error(`Ugyldig bruttoscore: ${grossStrokes}`);
  }

  if (!Number.isFinite(holePar) || holePar < 3) {
    throw new Error(`Ugyldigt par: ${par}`);
  }

  const handicapStrokes = getHandicapStrokesOnHole(
    playingHandicap,
    strokeIndex
  );

  const netStrokes = gross - handicapStrokes;
  const netToPar = netStrokes - holePar;

  return {
    grossStrokes: gross,
    par: holePar,
    strokeIndex: toNumber(strokeIndex),
    playingHandicap: Math.trunc(toNumber(playingHandicap)),
    handicapStrokes,
    netStrokes,
    netToPar,
  };
}

export function calculatePlayerNetRound({
  playerId,
  playerName,
  playingHandicap,
  holes,
  scores,
}) {
  const scoresByHole = new Map(
    (scores ?? []).map((score) => [
      Number(score.hole_number),
      score.strokes,
    ])
  );

  const holeResults = (holes ?? [])
    .map((hole) => {
      const holeNumber = Number(hole.hole_number);
      const grossStrokes = scoresByHole.get(holeNumber);
      const result = calculatePlayerNetHole({
        grossStrokes,
        par: hole.par,
        strokeIndex: hole.stroke_index,
        playingHandicap,
      });

      if (!result) {
        return {
          holeNumber,
          par: Number(hole.par),
          strokeIndex: Number(hole.stroke_index),
          completed: false,
          grossStrokes: null,
          handicapStrokes: null,
          netStrokes: null,
          netToPar: null,
        };
      }

      return {
        holeNumber,
        completed: true,
        ...result,
      };
    })
    .sort((a, b) => a.holeNumber - b.holeNumber);

  const completedHoles = holeResults.filter((hole) => hole.completed);

  return {
    playerId,
    playerName,
    playingHandicap: Math.trunc(toNumber(playingHandicap)),
    holesPlayed: completedHoles.length,
    grossToPar: completedHoles.reduce(
      (total, hole) => total + hole.grossStrokes - hole.par,
      0
    ),
    netToPar: completedHoles.reduce(
      (total, hole) => total + hole.netToPar,
      0
    ),
    holeResults,
  };
}

export function calculateBestBallHole({
  hole,
  players,
  scores,
}) {
  const holeNumber = Number(hole.hole_number);

  const playerResults = (players ?? []).map((player) => {
    const playerScore = (scores ?? []).find(
      (score) =>
        score.player_id === player.playerId &&
        Number(score.hole_number) === holeNumber
    );

    const netResult = calculatePlayerNetHole({
      grossStrokes: playerScore?.strokes,
      par: hole.par,
      strokeIndex: hole.stroke_index,
      playingHandicap: player.playingHandicap,
    });

    return {
      playerId: player.playerId,
      playerName: player.playerName,
      playingHandicap: player.playingHandicap,
      completed: Boolean(netResult),
      ...netResult,
    };
  });

  const completed =
    playerResults.length > 0 &&
    playerResults.every((player) => player.completed);

  if (!completed) {
    return {
      holeNumber,
      par: Number(hole.par),
      strokeIndex: Number(hole.stroke_index),
      completed: false,
      teamNetToPar: null,
      countingPlayerId: null,
      countingPlayerName: null,
      playerResults,
    };
  }

  const bestResult = [...playerResults].sort((a, b) => {
    if (a.netToPar !== b.netToPar) return a.netToPar - b.netToPar;
    if (a.netStrokes !== b.netStrokes) {
      return a.netStrokes - b.netStrokes;
    }
    return a.playerName.localeCompare(b.playerName, "da");
  })[0];

  return {
    holeNumber,
    par: Number(hole.par),
    strokeIndex: Number(hole.stroke_index),
    completed: true,
    teamNetToPar: bestResult.netToPar,
    countingPlayerId: bestResult.playerId,
    countingPlayerName: bestResult.playerName,
    countingNetStrokes: bestResult.netStrokes,
    playerResults,
  };
}

export function calculateBestBallTeam({
  teamId,
  teamName,
  players,
  holes,
  scores,
}) {
  const eligiblePlayers = (players ?? []).filter(
    (player) => player.teamCompetition !== false
  );

  if (eligiblePlayers.length !== 2) {
    return {
      teamId,
      teamName,
      players: eligiblePlayers,
      holesPlayed: 0,
      netToPar: null,
      valid: false,
      error: "Holdet skal have præcis to deltagende spillere.",
      holeResults: [],
    };
  }

  const holeResults = (holes ?? [])
    .map((hole) =>
      calculateBestBallHole({
        hole,
        players: eligiblePlayers,
        scores,
      })
    )
    .sort((a, b) => a.holeNumber - b.holeNumber);

  const completedHoles = holeResults.filter((hole) => hole.completed);

  return {
    teamId,
    teamName,
    players: eligiblePlayers,
    holesPlayed: completedHoles.length,
    netToPar: completedHoles.reduce(
      (total, hole) => total + hole.teamNetToPar,
      0
    ),
    valid: true,
    error: null,
    holeResults,
  };
}

export function calculateBestBallLeaderboard({
  teams,
  holes,
  scores,
}) {
  return (teams ?? [])
    .map((team) =>
      calculateBestBallTeam({
        teamId: team.teamId,
        teamName: team.teamName,
        players: team.players,
        holes,
        scores,
      })
    )
    .filter((team) => team.valid)
    .sort((a, b) => {
      if (a.holesPlayed !== b.holesPlayed) {
        return b.holesPlayed - a.holesPlayed;
      }
      if (a.netToPar !== b.netToPar) {
        return a.netToPar - b.netToPar;
      }
      return a.teamName.localeCompare(b.teamName, "da");
    });
}
