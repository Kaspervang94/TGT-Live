import { supabase } from "./supabase";
import { getLiveRoundLeaderboard } from "./liveLeaderboard";
import {
  applyIndividualBonuses,
} from "./individualBonus";

function validNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

async function getApprovedBonuses(roundId) {
  if (!roundId) {
    return [];
  }

  const { data, error } = await supabase
    .from("closest_to_pin")
    .select(`
      id,
      round_id,
      hole_number,
      player_id,
      bonus_strokes,
      approved
    `)
    .eq("round_id", roundId)
    .eq("approved", true);

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function getOfficialRoundLeaderboard(
  roundNumber
) {
  const liveData =
    await getLiveRoundLeaderboard(
      roundNumber
    );

  if (!liveData?.round?.id) {
    throw new Error(
      `Runde ${roundNumber} blev ikke fundet.`
    );
  }

  const approvedBonuses =
    await getApprovedBonuses(
      liveData.round.id
    );

  const leaderboard =
    applyIndividualBonuses({
      leaderboard:
        liveData.leaderboard ?? [],
      approvedBonuses,
    });

  return {
    round: liveData.round,
    leaderboard,
    approvedBonuses,
  };
}

function createPlayerMap(leaderboard) {
  return new Map(
    (leaderboard ?? []).map(
      (player) => [
        player.playerId,
        player,
      ]
    )
  );
}

function sortFinalStandings(players) {
  return [...players].sort((a, b) => {
    if (
      a.finalCompleted !==
      b.finalCompleted
    ) {
      return a.finalCompleted
        ? -1
        : 1;
    }

    const aScore =
      a.finalScore ?? Infinity;

    const bScore =
      b.finalScore ?? Infinity;

    if (aScore !== bScore) {
      return aScore - bScore;
    }

    const roundSevenDifference =
      (
        a.roundSevenOfficialScore ??
        Infinity
      ) -
      (
        b.roundSevenOfficialScore ??
        Infinity
      );

    if (roundSevenDifference !== 0) {
      return roundSevenDifference;
    }

    const roundSixDifference =
      (
        a.roundSixOfficialScore ??
        Infinity
      ) -
      (
        b.roundSixOfficialScore ??
        Infinity
      );

    if (roundSixDifference !== 0) {
      return roundSixDifference;
    }

    const startingDifference =
      (
        a.startingScore ??
        Infinity
      ) -
      (
        b.startingScore ??
        Infinity
      );

    if (startingDifference !== 0) {
      return startingDifference;
    }

    return a.playerName.localeCompare(
      b.playerName,
      "da"
    );
  });
}

function addPositions(players) {
  return players.map(
    (player, index) => ({
      ...player,
      position: index + 1,
    })
  );
}

export async function getFinalStandings({
  season = 2026,
  roundSixNumber = 6,
  roundSevenNumber = 7,
} = {}) {
  const {
    data: seasonRows,
    error: seasonError,
  } = await supabase
    .from(
      "season_individual_standings"
    )
    .select(`
      tournament_id,
      season,
      player_id,
      player_name,
      rounds_played,
      counting_rounds,
      counting_score,
      halved_score
    `)
    .eq("season", season);

  if (seasonError) {
    throw seasonError;
  }

  const [
    roundSixData,
    roundSevenData,
  ] = await Promise.all([
    getOfficialRoundLeaderboard(
      roundSixNumber
    ),
    getOfficialRoundLeaderboard(
      roundSevenNumber
    ),
  ]);

  const roundSixByPlayer =
    createPlayerMap(
      roundSixData.leaderboard
    );

  const roundSevenByPlayer =
    createPlayerMap(
      roundSevenData.leaderboard
    );

  const combinedPlayers =
    (seasonRows ?? []).map(
      (seasonPlayer) => {
        const roundSix =
          roundSixByPlayer.get(
            seasonPlayer.player_id
          );

        const roundSeven =
          roundSevenByPlayer.get(
            seasonPlayer.player_id
          );

        const startingScore =
          validNumber(
            seasonPlayer.halved_score
          );

        const roundSixOfficialScore =
          validNumber(
            roundSix?.officialToPar
          );

        const roundSevenOfficialScore =
          validNumber(
            roundSeven?.officialToPar
          );

        const roundSixCompleted =
          roundSix?.holesPlayed === 18;

        const roundSevenCompleted =
          roundSeven?.holesPlayed === 18;

        const finalCompleted =
          startingScore !== null &&
          roundSixCompleted &&
          roundSevenCompleted;

        const finalScore =
          finalCompleted
            ? startingScore +
              roundSixOfficialScore +
              roundSevenOfficialScore
            : null;

        return {
          playerId:
            seasonPlayer.player_id,

          playerName:
            seasonPlayer.player_name,

          startingScore,

          roundSixHoles:
            roundSix?.holesPlayed ?? 0,

          roundSixGrossScore:
            validNumber(
              roundSix?.scoreToPar
            ),

          roundSixEarnedBonus:
            roundSix?.earnedBonus ?? 0,

          roundSixAppliedBonus:
            roundSix?.appliedBonus ?? 0,

          roundSixOfficialScore,

          roundSixCompleted,

          roundSevenHoles:
            roundSeven?.holesPlayed ?? 0,

          roundSevenGrossScore:
            validNumber(
              roundSeven?.scoreToPar
            ),

          roundSevenEarnedBonus:
            roundSeven?.earnedBonus ?? 0,

          roundSevenAppliedBonus:
            roundSeven?.appliedBonus ?? 0,

          roundSevenOfficialScore,

          roundSevenCompleted,

          finalScore,
          finalCompleted,
        };
      }
    );

  const standings =
    addPositions(
      sortFinalStandings(
        combinedPlayers
      )
    );

  const completedPlayers =
    standings.filter(
      (player) =>
        player.finalCompleted
    );

  const incompletePlayers =
    standings.filter(
      (player) =>
        !player.finalCompleted
    );

  const champion =
    completedPlayers.length ===
      standings.length &&
    standings.length > 0
      ? standings[0]
      : null;

  return {
    season,
    roundSix:
      roundSixData.round,
    roundSeven:
      roundSevenData.round,
    standings,
    completedPlayers:
      completedPlayers.length,
    incompletePlayers,
    finalCompleted:
      standings.length === 15 &&
      completedPlayers.length === 15,
    champion,
  };
}

export function validateFinalStandings(
  finalData
) {
  const errors = [];

  if (
    finalData?.standings?.length !== 15
  ) {
    errors.push(
      `Der blev fundet ${
        finalData?.standings?.length ?? 0
      } spillere. Der skal være 15.`
    );
  }

  const playerIds =
    (
      finalData?.standings ?? []
    ).map(
      (player) => player.playerId
    );

  const uniquePlayerIds =
    new Set(playerIds);

  if (
    uniquePlayerIds.size !==
    playerIds.length
  ) {
    errors.push(
      "Mindst én spiller optræder flere gange."
    );
  }

  if (
    finalData?.incompletePlayers
      ?.length > 0
  ) {
    errors.push(
      `${finalData.incompletePlayers.length} spillere mangler at gennemføre hele finaleforløbet.`
    );
  }

  if (!finalData?.finalCompleted) {
    errors.push(
      "Finalestillingen er endnu ikke endelig."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}