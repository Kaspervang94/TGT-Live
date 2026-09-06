import { supabase } from "./supabase";

function normalizeEmail(email) {
  const value = email?.trim().toLowerCase();

  return value || null;
}

function normalizeHandicap(handicapIndex) {
  if (
    handicapIndex === null ||
    handicapIndex === undefined ||
    handicapIndex === ""
  ) {
    return null;
  }

  const value = Number(handicapIndex);

  if (!Number.isFinite(value)) {
    throw new Error(
      "Handicap Index skal være et gyldigt tal."
    );
  }

  if (value < -10 || value > 54) {
    throw new Error(
      "Handicap Index skal være mellem -10 og 54."
    );
  }

  return value;
}

function normalizePlayerName(name) {
  const value = name?.trim();

  if (!value) {
    throw new Error(
      "Spillerens navn skal udfyldes."
    );
  }

  return value;
}

/**
 * Henter én sæson ud fra årstallet.
 */
export async function getTournamentBySeason(
  season
) {
  const seasonNumber = Number(season);

  if (!Number.isInteger(seasonNumber)) {
    throw new Error(
      "Der skal angives en gyldig sæson."
    );
  }

  const { data, error } = await supabase
    .from("tournaments")
    .select(`
      id,
      name,
      season,
      status,
      is_public,
      counting_rounds,
      halve_counting_score,
      closest_to_pin_bonus,
      locked_at,
      locked_by,
      created_at
    `)
    .eq("season", seasonNumber)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Henter alle spillere i en bestemt sæson.
 *
 * Både aktive og inaktive spillere medtages,
 * så admin kan genaktivere en spiller.
 */
export async function getSeasonPlayers(
  season = 2027
) {
  const tournament =
    await getTournamentBySeason(season);

  if (!tournament) {
    throw new Error(
      `TGT ${season} blev ikke fundet.`
    );
  }

  const { data, error } = await supabase
    .from("players")
    .select(`
      id,
      tournament_id,
      name,
      email,
      active,
      handicap_index,
      gender_code,
      team_competition,
      created_at
    `)
    .eq(
      "tournament_id",
      tournament.id
    )
    .order("name", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return {
    tournament,
    players: data ?? [],
  };
}

/**
 * Opdaterer en eksisterende spiller.
 *
 * Funktionen kan ændre:
 * - Navn
 * - E-mail
 * - Handicap Index
 * - Aktiv eller inaktiv
 * - Deltagelse i holdturneringen
 * - Gender code
 */
export async function updateSeasonPlayer({
  playerId,
  name,
  email,
  handicapIndex,
  active,
  teamCompetition,
  genderCode,
}) {
  if (!playerId) {
    throw new Error(
      "Spiller-ID mangler."
    );
  }

  const normalizedName =
    normalizePlayerName(name);

  const normalizedHandicap =
    normalizeHandicap(handicapIndex);

  const { data, error } = await supabase
    .from("players")
    .update({
      name: normalizedName,
      email: normalizeEmail(email),
      handicap_index:
        normalizedHandicap,
      active: active !== false,
      team_competition:
        teamCompetition !== false,
      gender_code:
        genderCode?.trim() || null,
    })
    .eq("id", playerId)
    .select(`
      id,
      tournament_id,
      name,
      email,
      active,
      handicap_index,
      gender_code,
      team_competition,
      created_at
    `)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Opretter en ny spiller i en bestemt sæson.
 *
 * Funktionen opretter ikke spilleren i tidligere
 * sæsoner og kopierer ingen historiske resultater.
 */
export async function createSeasonPlayer({
  season = 2027,
  name,
  email = null,
  handicapIndex = null,
  active = true,
  teamCompetition = true,
  genderCode = null,
}) {
  const tournament =
    await getTournamentBySeason(season);

  if (!tournament) {
    throw new Error(
      `TGT ${season} blev ikke fundet.`
    );
  }

  if (tournament.locked_at) {
    throw new Error(
      `TGT ${season} er låst.`
    );
  }

  const normalizedName =
    normalizePlayerName(name);

  const normalizedEmail =
    normalizeEmail(email);

  const normalizedHandicap =
    normalizeHandicap(handicapIndex);

  const { data: existingPlayers, error: existingError } =
    await supabase
      .from("players")
      .select(`
        id,
        name,
        email
      `)
      .eq(
        "tournament_id",
        tournament.id
      );

  if (existingError) {
    throw existingError;
  }

  const duplicateName = (
    existingPlayers ?? []
  ).find(
    (player) =>
      player.name.trim().toLowerCase() ===
      normalizedName.toLowerCase()
  );

  if (duplicateName) {
    throw new Error(
      `${normalizedName} findes allerede i TGT ${season}.`
    );
  }

  if (normalizedEmail) {
    const duplicateEmail = (
      existingPlayers ?? []
    ).find(
      (player) =>
        player.email?.trim().toLowerCase() ===
        normalizedEmail
    );

    if (duplicateEmail) {
      throw new Error(
        `E-mailadressen bruges allerede af en spiller i TGT ${season}.`
      );
    }
  }

  const { data, error } = await supabase
    .from("players")
    .insert({
      tournament_id:
        tournament.id,
      name: normalizedName,
      email: normalizedEmail,
      active: active !== false,
      handicap_index:
        normalizedHandicap,
      gender_code:
        genderCode?.trim() || null,
      team_competition:
        teamCompetition !== false,
    })
    .select(`
      id,
      tournament_id,
      name,
      email,
      active,
      handicap_index,
      gender_code,
      team_competition,
      created_at
    `)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Aktiverer eller deaktiverer en spiller.
 *
 * Spilleren slettes ikke. Det bevarer
 * spillerens ID og mulige fremtidige relationer.
 */
export async function setSeasonPlayerActive({
  playerId,
  active,
}) {
  if (!playerId) {
    throw new Error(
      "Spiller-ID mangler."
    );
  }

  const { data, error } = await supabase
    .from("players")
    .update({
      active: Boolean(active),
    })
    .eq("id", playerId)
    .select(`
      id,
      tournament_id,
      name,
      email,
      active,
      handicap_index,
      gender_code,
      team_competition,
      created_at
    `)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Ændrer deltagelse i holdturneringen.
 *
 * En spiller kan fortsat være aktiv individuelt,
 * selv om team_competition er false.
 */
export async function setTeamCompetition({
  playerId,
  teamCompetition,
}) {
  if (!playerId) {
    throw new Error(
      "Spiller-ID mangler."
    );
  }

  const { data, error } = await supabase
    .from("players")
    .update({
      team_competition:
        Boolean(teamCompetition),
    })
    .eq("id", playerId)
    .select(`
      id,
      tournament_id,
      name,
      email,
      active,
      handicap_index,
      gender_code,
      team_competition,
      created_at
    `)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Opdaterer kun spillerens Handicap Index.
 */
export async function updatePlayerHandicap({
  playerId,
  handicapIndex,
}) {
  if (!playerId) {
    throw new Error(
      "Spiller-ID mangler."
    );
  }

  const normalizedHandicap =
    normalizeHandicap(handicapIndex);

  const { data, error } = await supabase
    .from("players")
    .update({
      handicap_index:
        normalizedHandicap,
    })
    .eq("id", playerId)
    .select(`
      id,
      tournament_id,
      name,
      email,
      active,
      handicap_index,
      gender_code,
      team_competition,
      created_at
    `)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Returnerer en kort status for sæsonens
 * spilleropsætning.
 */
export function summarizeSeasonPlayers(
  players
) {
  const allPlayers = players ?? [];

  const activePlayers =
    allPlayers.filter(
      (player) => player.active
    );

  const inactivePlayers =
    allPlayers.filter(
      (player) => !player.active
    );

  const teamPlayers =
    activePlayers.filter(
      (player) =>
        player.team_competition
    );

  const individualOnlyPlayers =
    activePlayers.filter(
      (player) =>
        !player.team_competition
    );

  const missingHandicap =
    activePlayers.filter(
      (player) =>
        player.handicap_index === null ||
        player.handicap_index ===
          undefined
    );

  return {
    totalPlayers:
      allPlayers.length,
    activePlayers:
      activePlayers.length,
    inactivePlayers:
      inactivePlayers.length,
    teamPlayers:
      teamPlayers.length,
    individualOnlyPlayers:
      individualOnlyPlayers.length,
    missingHandicap:
      missingHandicap.length,
  };
}