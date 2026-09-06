import { supabase } from "./supabase";
import { getTournamentBySeason } from "./seasonAdmin";

const REGISTERED_STATUS = "registered";
const WITHDRAWN_STATUS = "withdrawn";

async function getRound(roundId) {
  if (!roundId) {
    throw new Error("Vælg en runde.");
  }

  const { data, error } = await supabase
    .from("rounds")
    .select(`
      id,
      tournament_id,
      course_id,
      tee_id,
      round_number,
      name,
      played_at,
      status,
      locked_at,
      tournaments (
        id,
        season,
        locked_at
      )
    `)
    .eq("id", roundId)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

function ensureRoundIsEditable(round) {
  if (round.locked_at) {
    throw new Error(`Runde ${round.round_number} er låst.`);
  }

  if (round.tournaments?.locked_at) {
    throw new Error(`TGT ${round.tournaments.season} er låst.`);
  }
}

export async function getRoundParticipants({
  season = 2027,
  roundId,
}) {
  const tournament = await getTournamentBySeason(season);

  if (!tournament) {
    throw new Error(`TGT ${season} blev ikke fundet.`);
  }

  const round = await getRound(roundId);

  if (round.tournament_id !== tournament.id) {
    throw new Error(`Runden tilhører ikke TGT ${season}.`);
  }

  const [playersResult, registrationsResult] = await Promise.all([
    supabase
      .from("players")
      .select(`
        id,
        tournament_id,
        name,
        email,
        handicap_index,
        active,
        team_competition
      `)
      .eq("tournament_id", tournament.id)
      .eq("active", true)
      .order("name", { ascending: true }),

    supabase
      .from("round_players")
      .select(`
        round_id,
        player_id,
        handicap_index,
        playing_handicap,
        tee_id,
        status,
        created_at
      `)
      .eq("round_id", roundId),
  ]);

  if (playersResult.error) {
    throw playersResult.error;
  }

  if (registrationsResult.error) {
    throw registrationsResult.error;
  }

  const registrationByPlayerId = new Map(
    (registrationsResult.data ?? []).map((registration) => [
      registration.player_id,
      registration,
    ])
  );

  const participants = (playersResult.data ?? []).map((player) => {
    const registration = registrationByPlayerId.get(player.id);

    return {
      playerId: player.id,
      playerName: player.name,
      email: player.email,
      active: player.active,
      teamCompetition: player.team_competition,
      currentHandicapIndex: player.handicap_index,
      roundHandicapIndex:
        registration?.handicap_index ?? player.handicap_index ?? null,
      playingHandicap: registration?.playing_handicap ?? null,
      teeId: registration?.tee_id ?? round.tee_id ?? null,
      status: registration?.status ?? REGISTERED_STATUS,
      hasRegistration: Boolean(registration),
      isRegistered:
        !registration || registration.status === REGISTERED_STATUS,
    };
  });

  return {
    tournament,
    round,
    participants,
  };
}

export async function setRoundParticipantStatus({
  roundId,
  playerId,
  registered,
}) {
  if (!playerId) {
    throw new Error("Spiller-ID mangler.");
  }

  const round = await getRound(roundId);
  ensureRoundIsEditable(round);

  const { data: player, error: playerError } = await supabase
    .from("players")
    .select(`
      id,
      tournament_id,
      name,
      handicap_index,
      active
    `)
    .eq("id", playerId)
    .single();

  if (playerError) {
    throw playerError;
  }

  if (player.tournament_id !== round.tournament_id) {
    throw new Error("Spilleren tilhører ikke rundens sæson.");
  }

  if (!player.active) {
    throw new Error(`${player.name} er ikke aktiv i sæsonen.`);
  }

  const status = registered ? REGISTERED_STATUS : WITHDRAWN_STATUS;

  const { data, error } = await supabase
    .from("round_players")
    .upsert(
      {
        round_id: round.id,
        player_id: player.id,
        handicap_index: player.handicap_index,
        playing_handicap: null,
        tee_id: round.tee_id,
        status,
      },
      {
        onConflict: "round_id,player_id",
      }
    )
    .select(`
      round_id,
      player_id,
      handicap_index,
      playing_handicap,
      tee_id,
      status,
      created_at
    `)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function saveRoundParticipants({
  roundId,
  participants,
}) {
  const round = await getRound(roundId);
  ensureRoundIsEditable(round);

  const participantRows = participants ?? [];

  if (participantRows.length === 0) {
    throw new Error("Der er ingen deltagere at gemme.");
  }

  const playerIds = participantRows.map((participant) => participant.playerId);

  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error("En spiller optræder flere gange i deltagerlisten.");
  }

  const { data: players, error: playerError } = await supabase
    .from("players")
    .select(`
      id,
      tournament_id,
      name,
      handicap_index,
      active
    `)
    .in("id", playerIds);

  if (playerError) {
    throw playerError;
  }

  const playersById = new Map(
    (players ?? []).map((player) => [player.id, player])
  );

  const rows = participantRows.map((participant) => {
    const player = playersById.get(participant.playerId);

    if (!player || player.tournament_id !== round.tournament_id) {
      throw new Error("En eller flere spillere tilhører ikke rundens sæson.");
    }

    if (!player.active) {
      throw new Error(`${player.name} er ikke aktiv i sæsonen.`);
    }

    return {
      round_id: round.id,
      player_id: player.id,
      handicap_index: player.handicap_index,
      playing_handicap: null,
      tee_id: round.tee_id,
      status: participant.registered
        ? REGISTERED_STATUS
        : WITHDRAWN_STATUS,
    };
  });

  const { data, error } = await supabase
    .from("round_players")
    .upsert(rows, {
      onConflict: "round_id,player_id",
    })
    .select(`
      round_id,
      player_id,
      handicap_index,
      playing_handicap,
      tee_id,
      status,
      created_at
    `);

  if (error) {
    throw error;
  }

  return data ?? [];
}

export function summarizeRoundParticipants(participants) {
  const rows = participants ?? [];
  const registered = rows.filter(
    (participant) => participant.isRegistered
  );
  const withdrawn = rows.filter(
    (participant) => !participant.isRegistered
  );
  const missingHandicap = registered.filter(
    (participant) =>
      participant.currentHandicapIndex === null ||
      participant.currentHandicapIndex === undefined
  );

  return {
    totalPlayers: rows.length,
    registeredPlayers: registered.length,
    withdrawnPlayers: withdrawn.length,
    missingHandicap: missingHandicap.length,
  };
}

export function getRegisteredParticipants(participants) {
  return (participants ?? []).filter(
    (participant) => participant.isRegistered
  );
}
