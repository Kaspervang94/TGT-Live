import { supabase } from "./supabase";
import { getSeasonRounds } from "./roundAdmin";
import { getRoundParticipants } from "./roundParticipants";

function normalizeFlightNumber(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error("Boldnummer skal være et positivt heltal.");
  }
  return number;
}

function normalizeFlightName(name, flightNumber) {
  return name?.trim() || `Bold ${flightNumber}`;
}

function normalizeTeeTime(value) {
  if (!value) return null;
  const time = String(value).trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) {
    throw new Error("Starttid skal angives som TT:MM.");
  }
  return time.length === 5 ? `${time}:00` : time;
}

async function getRoundForAdmin(roundId) {
  if (!roundId) throw new Error("Vælg en runde.");

  const { data, error } = await supabase
    .from("rounds")
    .select(`
      id,
      tournament_id,
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

  if (error) throw error;
  return data;
}

function ensureRoundEditable(round) {
  if (round.locked_at) {
    throw new Error(`Runde ${round.round_number} er låst.`);
  }
  if (round.tournaments?.locked_at) {
    throw new Error(`TGT ${round.tournaments.season} er låst.`);
  }
}

export async function getFlightAdminData({
  season = 2027,
  roundId,
}) {
  const round = await getRoundForAdmin(roundId);

  if (Number(round.tournaments?.season) !== Number(season)) {
    throw new Error(`Runden tilhører ikke TGT ${season}.`);
  }

  const [flightsResult, participantsResult] = await Promise.all([
    supabase
      .from("flights")
      .select(`
        id,
        round_id,
        name,
        flight_number,
        tee_time,
        status,
        created_at,
        flight_players (
          flight_id,
          round_id,
          player_id,
          playing_order,
          players (
            id,
            name,
            handicap_index,
            active
          )
        ),
        flight_markers (
          flight_id,
          user_id,
          player_id,
          active,
          assigned_at
        )
      `)
      .eq("round_id", roundId)
      .order("flight_number", { ascending: true }),

    getRoundParticipants({ season, roundId }),
  ]);

  if (flightsResult.error) throw flightsResult.error;

  const registeredParticipants = participantsResult.participants.filter(
    (participant) => participant.isRegistered
  );

  const flights = (flightsResult.data ?? []).map((flight) => ({
    ...flight,
    players: [...(flight.flight_players ?? [])]
      .sort((a, b) => a.playing_order - b.playing_order)
      .map((row) => ({
        playerId: row.player_id,
        playerName: row.players?.name ?? "Ukendt spiller",
        handicapIndex: row.players?.handicap_index ?? null,
        playingOrder: row.playing_order,
      })),
    markers: (flight.flight_markers ?? []).filter(
      (marker) => marker.active
    ),
  }));

  return {
    round,
    flights,
    registeredParticipants,
  };
}

export async function getSeasonRoundsForFlights(season = 2027) {
  const result = await getSeasonRounds(season);
  return result.rounds;
}

export async function createFlight({
  roundId,
  flightNumber,
  name,
  teeTime = null,
}) {
  const round = await getRoundForAdmin(roundId);
  ensureRoundEditable(round);

  const normalizedNumber = normalizeFlightNumber(flightNumber);
  const normalizedName = normalizeFlightName(name, normalizedNumber);
  const normalizedTime = normalizeTeeTime(teeTime);

  const { data, error } = await supabase
    .from("flights")
    .insert({
      round_id: round.id,
      name: normalizedName,
      flight_number: normalizedNumber,
      tee_time: normalizedTime,
      status: "not_started",
    })
    .select(`
      id,
      round_id,
      name,
      flight_number,
      tee_time,
      status,
      created_at
    `)
    .single();

  if (error) throw error;
  return data;
}

export async function updateFlight({
  flightId,
  name,
  flightNumber,
  teeTime,
}) {
  if (!flightId) throw new Error("Bold-ID mangler.");

  const { data: currentFlight, error: currentError } = await supabase
    .from("flights")
    .select(`
      id,
      round_id,
      round:rounds (
        id,
        round_number,
        locked_at,
        tournaments (
          season,
          locked_at
        )
      )
    `)
    .eq("id", flightId)
    .single();

  if (currentError) throw currentError;
  ensureRoundEditable(currentFlight.round);

  const normalizedNumber = normalizeFlightNumber(flightNumber);

  const { data, error } = await supabase
    .from("flights")
    .update({
      name: normalizeFlightName(name, normalizedNumber),
      flight_number: normalizedNumber,
      tee_time: normalizeTeeTime(teeTime),
    })
    .eq("id", flightId)
    .select(`
      id,
      round_id,
      name,
      flight_number,
      tee_time,
      status,
      created_at
    `)
    .single();

  if (error) throw error;
  return data;
}

export async function saveFlightPlayers({
  roundId,
  flights,
}) {
  const round = await getRoundForAdmin(roundId);
  ensureRoundEditable(round);

  const participantData = await getRoundParticipants({
    season: round.tournaments.season,
    roundId,
  });

  const registeredIds = new Set(
    participantData.participants
      .filter((participant) => participant.isRegistered)
      .map((participant) => participant.playerId)
  );

  const assignments = (flights ?? []).flatMap((flight) =>
    (flight.playerIds ?? [])
      .filter(Boolean)
      .map((playerId, index) => ({
        flight_id: flight.flightId,
        round_id: roundId,
        player_id: playerId,
        playing_order: index + 1,
      }))
  );

  const playerIds = assignments.map((row) => row.player_id);
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error("En spiller er placeret i flere bolde.");
  }

  const invalidPlayerId = playerIds.find(
    (playerId) => !registeredIds.has(playerId)
  );
  if (invalidPlayerId) {
    throw new Error("En frameldt eller ugyldig spiller er placeret i en bold.");
  }

  const flightIds = (flights ?? []).map((flight) => flight.flightId);
  if (flightIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("flight_players")
      .delete()
      .eq("round_id", roundId)
      .in("flight_id", flightIds);

    if (deleteError) throw deleteError;
  }

  if (assignments.length === 0) return [];

  const { data, error } = await supabase
    .from("flight_players")
    .insert(assignments)
    .select(`
      flight_id,
      round_id,
      player_id,
      playing_order
    `);

  if (error) throw error;
  return data ?? [];
}

export async function deleteEmptyFlight(flightId) {
  if (!flightId) throw new Error("Bold-ID mangler.");

  const { data: players, error: playerError } = await supabase
    .from("flight_players")
    .select("player_id")
    .eq("flight_id", flightId);

  if (playerError) throw playerError;
  if ((players ?? []).length > 0) {
    throw new Error("Bolden skal være tom, før den kan slettes.");
  }

  const { error } = await supabase
    .from("flights")
    .delete()
    .eq("id", flightId);

  if (error) throw error;
}

export function summarizeFlightSetup({
  flights,
  registeredParticipants,
}) {
  const allFlights = flights ?? [];
  const registered = registeredParticipants ?? [];
  const assignedIds = new Set(
    allFlights.flatMap((flight) =>
      flight.players.map((player) => player.playerId)
    )
  );

  return {
    totalFlights: allFlights.length,
    registeredPlayers: registered.length,
    assignedPlayers: assignedIds.size,
    unassignedPlayers: registered.filter(
      (participant) => !assignedIds.has(participant.playerId)
    ),
    flightsWithoutTeeTime: allFlights.filter(
      (flight) => !flight.tee_time
    ).length,
    invalidFlights: allFlights.filter(
      (flight) => flight.players.length === 0
    ).length,
  };
}
