import { supabase } from "./supabase";
import { getTournamentBySeason } from "./seasonAdmin";

function normalizeRoundNumber(roundNumber) {
  const value = Number(roundNumber);

  if (
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new Error(
      "Rundenummer skal være et positivt heltal."
    );
  }

  return value;
}

function normalizeRoundName(name) {
  const value = name?.trim();

  if (!value) {
    throw new Error(
      "Rundens navn skal udfyldes."
    );
  }

  return value;
}

function normalizeDate(playedAt) {
  if (!playedAt) {
    throw new Error(
      "Rundens dato skal udfyldes."
    );
  }

  const value = String(playedAt).trim();

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw new Error(
      "Datoen skal angives i formatet ÅÅÅÅ-MM-DD."
    );
  }

  return value;
}

function normalizeRoundType(roundType) {
  const value =
    roundType?.trim() || "regular";

  return value;
}

async function validateCourseAndTee({
  courseId,
  teeId,
}) {
  if (!courseId) {
    throw new Error(
      "Der skal vælges en golfbane."
    );
  }

  if (!teeId) {
    throw new Error(
      "Der skal vælges et teested."
    );
  }

  const {
    data: course,
    error: courseError,
  } = await supabase
    .from("courses")
    .select(`
      id,
      club_name,
      course_name,
      active
    `)
    .eq("id", courseId)
    .single();

  if (courseError) {
    throw courseError;
  }

  if (!course?.active) {
    throw new Error(
      "Den valgte golfbane er ikke aktiv."
    );
  }

  const {
    data: tee,
    error: teeError,
  } = await supabase
    .from("course_tees")
    .select(`
      id,
      course_id,
      tee_name,
      course_rating,
      slope_rating,
      total_length_meters
    `)
    .eq("id", teeId)
    .eq("course_id", courseId)
    .single();

  if (teeError) {
    throw teeError;
  }

  return {
    course,
    tee,
  };
}

/**
 * Henter alle aktive golfbaner.
 */
export async function getActiveCourses() {
  const { data, error } = await supabase
    .from("courses")
    .select(`
      id,
      club_name,
      course_name,
      country_code,
      active,
      created_at
    `)
    .eq("active", true)
    .order("club_name", {
      ascending: true,
    })
    .order("course_name", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return data ?? [];
}

/**
 * Henter alle tees på en bestemt bane.
 */
export async function getCourseTees(
  courseId
) {
  if (!courseId) {
    return [];
  }

  const { data, error } = await supabase
    .from("course_tees")
    .select(`
      id,
      course_id,
      tee_name,
      course_rating,
      slope_rating,
      total_length_meters,
      created_at
    `)
    .eq("course_id", courseId)
    .order("tee_name", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return data ?? [];
}

/**
 * Henter alle runder i en bestemt sæson.
 */
export async function getSeasonRounds(
  season = 2027
) {
  const tournament =
    await getTournamentBySeason(season);

  if (!tournament) {
    throw new Error(
      `TGT ${season} blev ikke fundet.`
    );
  }

  const {
    data: rounds,
    error: roundsError,
  } = await supabase
    .from("rounds")
    .select(`
      id,
      tournament_id,
      course_id,
      tee_id,
      round_number,
      name,
      played_at,
      round_type,
      status,
      individual_enabled,
      team_enabled,
      closest_to_pin_enabled,
      created_at,
      locked_at,
      locked_by,
      courses (
        id,
        club_name,
        course_name,
        country_code,
        active
      ),
      course_tees (
        id,
        course_id,
        tee_name,
        course_rating,
        slope_rating,
        total_length_meters
      )
    `)
    .eq(
      "tournament_id",
      tournament.id
    )
    .order("round_number", {
      ascending: true,
    });

  if (roundsError) {
    throw roundsError;
  }

  const courses =
    await getActiveCourses();

  return {
    tournament,
    rounds: rounds ?? [],
    courses,
  };
}

/**
 * Kontrollerer, at rundenummeret ikke
 * allerede bruges i samme sæson.
 */
async function validateUniqueRoundNumber({
  tournamentId,
  roundNumber,
  currentRoundId = null,
}) {
  let query = supabase
    .from("rounds")
    .select(`
      id,
      round_number,
      name
    `)
    .eq(
      "tournament_id",
      tournamentId
    )
    .eq(
      "round_number",
      roundNumber
    );

  if (currentRoundId) {
    query = query.neq(
      "id",
      currentRoundId
    );
  }

  const {
    data,
    error,
  } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    throw new Error(
      `Runde ${roundNumber} findes allerede i denne sæson.`
    );
  }
}

/**
 * Opretter en ny runde.
 */
export async function createSeasonRound({
  season = 2027,
  roundNumber,
  name,
  playedAt,
  courseId,
  teeId,
  roundType = "regular",
  individualEnabled = true,
  teamEnabled = true,
  closestToPinEnabled = true,
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

  const normalizedRoundNumber =
    normalizeRoundNumber(
      roundNumber
    );

  const normalizedName =
    normalizeRoundName(name);

  const normalizedPlayedAt =
    normalizeDate(playedAt);

  const normalizedRoundType =
    normalizeRoundType(roundType);

  await validateUniqueRoundNumber({
    tournamentId:
      tournament.id,
    roundNumber:
      normalizedRoundNumber,
  });

  await validateCourseAndTee({
    courseId,
    teeId,
  });

  const {
    data,
    error,
  } = await supabase
    .from("rounds")
    .insert({
      tournament_id:
        tournament.id,

      course_id:
        courseId,

      tee_id:
        teeId,

      round_number:
        normalizedRoundNumber,

      name:
        normalizedName,

      played_at:
        normalizedPlayedAt,

      round_type:
        normalizedRoundType,

      status:
        "draft",

      individual_enabled:
        Boolean(
          individualEnabled
        ),

      team_enabled:
        Boolean(
          teamEnabled
        ),

      closest_to_pin_enabled:
        Boolean(
          closestToPinEnabled
        ),

      locked_at:
        null,

      locked_by:
        null,
    })
    .select(`
      id,
      tournament_id,
      course_id,
      tee_id,
      round_number,
      name,
      played_at,
      round_type,
      status,
      individual_enabled,
      team_enabled,
      closest_to_pin_enabled,
      created_at,
      locked_at,
      locked_by
    `)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Opdaterer en eksisterende runde.
 *
 * En låst runde kan ikke redigeres.
 */
export async function updateSeasonRound({
  roundId,
  roundNumber,
  name,
  playedAt,
  courseId,
  teeId,
  roundType,
  individualEnabled,
  teamEnabled,
  closestToPinEnabled,
}) {
  if (!roundId) {
    throw new Error(
      "Runde-ID mangler."
    );
  }

  const {
    data: currentRound,
    error: currentRoundError,
  } = await supabase
    .from("rounds")
    .select(`
      id,
      tournament_id,
      round_number,
      locked_at,
      tournaments (
        id,
        season,
        locked_at
      )
    `)
    .eq("id", roundId)
    .single();

  if (currentRoundError) {
    throw currentRoundError;
  }

  if (currentRound.locked_at) {
    throw new Error(
      `Runde ${currentRound.round_number} er låst.`
    );
  }

  if (
    currentRound.tournaments
      ?.locked_at
  ) {
    throw new Error(
      `TGT ${currentRound.tournaments.season} er låst.`
    );
  }

  const normalizedRoundNumber =
    normalizeRoundNumber(
      roundNumber
    );

  const normalizedName =
    normalizeRoundName(name);

  const normalizedPlayedAt =
    normalizeDate(playedAt);

  const normalizedRoundType =
    normalizeRoundType(roundType);

  await validateUniqueRoundNumber({
    tournamentId:
      currentRound.tournament_id,

    roundNumber:
      normalizedRoundNumber,

    currentRoundId:
      roundId,
  });

  await validateCourseAndTee({
    courseId,
    teeId,
  });

  const {
    data,
    error,
  } = await supabase
    .from("rounds")
    .update({
      course_id:
        courseId,

      tee_id:
        teeId,

      round_number:
        normalizedRoundNumber,

      name:
        normalizedName,

      played_at:
        normalizedPlayedAt,

      round_type:
        normalizedRoundType,

      individual_enabled:
        Boolean(
          individualEnabled
        ),

      team_enabled:
        Boolean(
          teamEnabled
        ),

      closest_to_pin_enabled:
        Boolean(
          closestToPinEnabled
        ),
    })
    .eq("id", roundId)
    .select(`
      id,
      tournament_id,
      course_id,
      tee_id,
      round_number,
      name,
      played_at,
      round_type,
      status,
      individual_enabled,
      team_enabled,
      closest_to_pin_enabled,
      created_at,
      locked_at,
      locked_by
    `)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Opdaterer kun rundens status.
 */
export async function updateRoundStatus({
  roundId,
  status,
}) {
  if (!roundId) {
    throw new Error(
      "Runde-ID mangler."
    );
  }

  const normalizedStatus =
    status?.trim();

  if (!normalizedStatus) {
    throw new Error(
      "Rundestatus mangler."
    );
  }

  const {
    data: currentRound,
    error: currentRoundError,
  } = await supabase
    .from("rounds")
    .select(`
      id,
      round_number,
      locked_at
    `)
    .eq("id", roundId)
    .single();

  if (currentRoundError) {
    throw currentRoundError;
  }

  if (currentRound.locked_at) {
    throw new Error(
      `Runde ${currentRound.round_number} er låst.`
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("rounds")
    .update({
      status:
        normalizedStatus,
    })
    .eq("id", roundId)
    .select(`
      id,
      tournament_id,
      course_id,
      tee_id,
      round_number,
      name,
      played_at,
      round_type,
      status,
      individual_enabled,
      team_enabled,
      closest_to_pin_enabled,
      created_at,
      locked_at,
      locked_by
    `)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Returnerer en status for sæsonens runder.
 */
export function summarizeSeasonRounds(
  rounds
) {
  const allRounds =
    rounds ?? [];

  const draftRounds =
    allRounds.filter(
      (round) =>
        round.status === "draft"
    );

  const lockedRounds =
    allRounds.filter(
      (round) =>
        Boolean(round.locked_at)
    );

  const roundsWithoutCourse =
    allRounds.filter(
      (round) =>
        !round.course_id
    );

  const roundsWithoutTee =
    allRounds.filter(
      (round) =>
        !round.tee_id
    );

  const individualRounds =
    allRounds.filter(
      (round) =>
        round.individual_enabled
    );

  const teamRounds =
    allRounds.filter(
      (round) =>
        round.team_enabled
    );

  const closestToPinRounds =
    allRounds.filter(
      (round) =>
        round.closest_to_pin_enabled
    );

  return {
    totalRounds:
      allRounds.length,

    draftRounds:
      draftRounds.length,

    lockedRounds:
      lockedRounds.length,

    roundsWithoutCourse:
      roundsWithoutCourse.length,

    roundsWithoutTee:
      roundsWithoutTee.length,

    individualRounds:
      individualRounds.length,

    teamRounds:
      teamRounds.length,

    closestToPinRounds:
      closestToPinRounds.length,
  };
}