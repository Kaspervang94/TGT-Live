import { supabase } from "./supabase";
import {
  applyIndividualBonuses,
  sortIndividualLeaderboard,
} from "./individualBonus";
import { getLiveRoundLeaderboard } from "./liveLeaderboard";

const FINAL_FLIGHT_PLAN = [
  {
    flightNumber: 1,
    flightName: "Bold 1",
    firstPosition: 13,
    lastPosition: 15,
  },
  {
    flightNumber: 2,
    flightName: "Bold 2",
    firstPosition: 9,
    lastPosition: 12,
  },
  {
    flightNumber: 3,
    flightName: "Bold 3",
    firstPosition: 5,
    lastPosition: 8,
  },
  {
    flightNumber: 4,
    flightName: "Finalebold",
    firstPosition: 1,
    lastPosition: 4,
  },
];

function toNumber(value, fallback = null) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function sortFinalStandings(players) {
  return [...players].sort((a, b) => {
    if (
      a.hasCompletedRound !==
      b.hasCompletedRound
    ) {
      return a.hasCompletedRound ? -1 : 1;
    }

    const aFinalScore =
      a.finalScore ?? Infinity;

    const bFinalScore =
      b.finalScore ?? Infinity;

    if (aFinalScore !== bFinalScore) {
      return aFinalScore - bFinalScore;
    }

    const aRoundScore =
      a.officialRoundScore ?? Infinity;

    const bRoundScore =
      b.officialRoundScore ?? Infinity;

    if (aRoundScore !== bRoundScore) {
      return aRoundScore - bRoundScore;
    }

    const aStartingScore =
      a.startingScore ?? Infinity;

    const bStartingScore =
      b.startingScore ?? Infinity;

    if (aStartingScore !== bStartingScore) {
      return aStartingScore - bStartingScore;
    }

    return a.playerName.localeCompare(
      b.playerName,
      "da"
    );
  });
}

function assignPositions(players) {
  return players.map((player, index) => ({
    ...player,
    position: index + 1,
  }));
}

function createFlightPreview(positionedPlayers) {
  return FINAL_FLIGHT_PLAN.map((flight) => {
    const players = positionedPlayers
      .filter(
        (player) =>
          player.position >=
            flight.firstPosition &&
          player.position <=
            flight.lastPosition
      )
      .map((player, index) => ({
        ...player,
        playingOrder: index + 1,
      }));

    return {
      ...flight,
      players,
      playerCount: players.length,
    };
  });
}

export async function getFinalFlightsPreview({
  season = 2026,
  sourceRoundNumber = 6,
  finalRoundNumber = 7,
} = {}) {
  const {
    data: seasonRows,
    error: seasonError,
  } = await supabase
    .from("season_individual_standings")
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

  const liveData =
    await getLiveRoundLeaderboard(
      sourceRoundNumber
    );

  if (!liveData?.round?.id) {
    throw new Error(
      `Runde ${sourceRoundNumber} blev ikke fundet.`
    );
  }

  const {
    data: approvedBonuses,
    error: bonusError,
  } = await supabase
    .from("closest_to_pin")
    .select(`
      id,
      round_id,
      hole_number,
      player_id,
      bonus_strokes,
      approved
    `)
    .eq(
      "round_id",
      liveData.round.id
    )
    .eq("approved", true);

  if (bonusError) {
    throw bonusError;
  }

  const liveLeaderboard =
    sortIndividualLeaderboard(
      applyIndividualBonuses({
        leaderboard:
          liveData.leaderboard ?? [],
        approvedBonuses:
          approvedBonuses ?? [],
      })
    );

  const liveByPlayerId = new Map(
    liveLeaderboard.map((player) => [
      player.playerId,
      player,
    ])
  );

  const combinedPlayers = (
    seasonRows ?? []
  ).map((seasonPlayer) => {
    const livePlayer =
      liveByPlayerId.get(
        seasonPlayer.player_id
      );

    const startingScore = toNumber(
      seasonPlayer.halved_score
    );

    const officialRoundScore = toNumber(
      livePlayer?.officialToPar
    );

    const hasCompletedRound =
      livePlayer?.holesPlayed === 18;

    const finalScore =
      hasCompletedRound &&
      startingScore !== null &&
      officialRoundScore !== null
        ? startingScore +
          officialRoundScore
        : null;

    return {
      playerId:
        seasonPlayer.player_id,

      playerName:
        seasonPlayer.player_name,

      startingScore,

      holesPlayed:
        livePlayer?.holesPlayed ?? 0,

      grossRoundScore:
        toNumber(
          livePlayer?.scoreToPar
        ),

      earnedBonus:
        livePlayer?.earnedBonus ?? 0,

      appliedBonus:
        livePlayer?.appliedBonus ?? 0,

      officialRoundScore,

      finalScore,

      hasCompletedRound,
    };
  });

  const sortedPlayers =
    sortFinalStandings(
      combinedPlayers
    );

  const positionedPlayers =
    assignPositions(sortedPlayers);

  const flights =
    createFlightPreview(
      positionedPlayers
    );

  const {
    data: finalRound,
    error: finalRoundError,
  } = await supabase
    .from("rounds")
    .select(`
      id,
      round_number,
      name,
      played_at,
      status,
      course_id,
      tournament_id,
      tournaments!inner (
        season
      )
    `)
    .eq(
      "tournaments.season",
      season
    )
    .eq(
      "round_number",
      finalRoundNumber
    )
    .single();

  if (finalRoundError) {
    throw finalRoundError;
  }

  const completedPlayers =
    positionedPlayers.filter(
      (player) =>
        player.hasCompletedRound
    ).length;

  const incompletePlayers =
    positionedPlayers.filter(
      (player) =>
        !player.hasCompletedRound
    );

  return {
    season,
    sourceRound:
      liveData.round,
    finalRound,
    standings:
      positionedPlayers,
    flights,
    completedPlayers,
    incompletePlayers,
    canGenerate:
      positionedPlayers.length === 15 &&
      completedPlayers === 15,
  };
}

export function validateFinalFlightsPreview(
  preview
) {
  const errors = [];

  const allPlayers =
    preview?.flights?.flatMap(
      (flight) => flight.players
    ) ?? [];

  const playerIds = allPlayers.map(
    (player) => player.playerId
  );

  const uniquePlayerIds =
    new Set(playerIds);

  if (allPlayers.length !== 15) {
    errors.push(
      `Der blev fundet ${allPlayers.length} spillere. Der skal være 15.`
    );
  }

  if (
    uniquePlayerIds.size !==
    allPlayers.length
  ) {
    errors.push(
      "Mindst én spiller er placeret i flere finalebolde."
    );
  }

  if (
    preview?.incompletePlayers
      ?.length > 0
  ) {
    errors.push(
      "En eller flere spillere har ikke gennemført Runde 6."
    );
  }

  const expectedFlightSizes =
    new Map([
      [1, 3],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);

  (
    preview?.flights ?? []
  ).forEach((flight) => {
    const expectedSize =
      expectedFlightSizes.get(
        flight.flightNumber
      );

    if (
      flight.players.length !==
      expectedSize
    ) {
      errors.push(
        `${flight.flightName} har ${flight.players.length} spillere. Forventet: ${expectedSize}.`
      );
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}