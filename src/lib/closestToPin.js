import { supabase } from "./supabase";

/**
 * Henter tættest-på-pinden-kandidater
 * for en bestemt runde.
 */
export async function getClosestToPinEntries(
  roundId
) {
  if (!roundId) {
    throw new Error(
      "Runde-ID mangler ved hentning af kandidater."
    );
  }

  const { data, error } = await supabase
    .from("closest_to_pin_entries")
    .select(`
      id,
      round_id,
      flight_id,
      hole_number,
      player_id,
      distance_meters,
      updated_at,
      players (
        id,
        name
      ),
      flights (
        id,
        name,
        flight_number
      )
    `)
    .eq("round_id", roundId)
    .order("hole_number", {
      ascending: true,
    })
    .order("distance_meters", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return data ?? [];
}

/**
 * Henter den registrerede kandidat fra
 * en bestemt bold på et bestemt hul.
 */
export async function getFlightClosestEntry({
  roundId,
  flightId,
  holeNumber,
}) {
  if (!roundId || !flightId || !holeNumber) {
    return null;
  }

  const { data, error } = await supabase
    .from("closest_to_pin_entries")
    .select(`
      id,
      round_id,
      flight_id,
      hole_number,
      player_id,
      distance_meters,
      updated_at
    `)
    .eq("round_id", roundId)
    .eq("flight_id", flightId)
    .eq("hole_number", holeNumber)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Gemmer eller opdaterer boldens bedste kandidat
 * på et par 3-hul.
 *
 * Der kan kun findes én kandidat pr. bold pr. hul.
 */
export async function saveClosestToPinEntry({
  roundId,
  flightId,
  holeNumber,
  playerId,
  distanceMeters,
}) {
  if (!roundId) {
    throw new Error("Runde-ID mangler.");
  }

  if (!flightId) {
    throw new Error("Bold-ID mangler.");
  }

  if (!holeNumber) {
    throw new Error("Hulnummer mangler.");
  }

  if (!playerId) {
    throw new Error(
      "Vælg en spiller fra bolden."
    );
  }

  const distance = Number(distanceMeters);

  if (
    !Number.isFinite(distance) ||
    distance < 0
  ) {
    throw new Error(
      "Indtast en gyldig afstand i meter."
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error(
      "Du skal være logget ind som markør."
    );
  }

  const { data, error } = await supabase
    .from("closest_to_pin_entries")
    .upsert(
      {
        round_id: roundId,
        flight_id: flightId,
        hole_number: Number(holeNumber),
        player_id: playerId,
        distance_meters: distance,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict:
          "round_id,flight_id,hole_number",
      }
    )
    .select(`
      id,
      round_id,
      flight_id,
      hole_number,
      player_id,
      distance_meters,
      updated_at
    `)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Sletter boldens kandidat på et bestemt hul.
 *
 * Bruges eksempelvis, hvis registreringen
 * blev foretaget ved en fejl.
 */
export async function deleteClosestToPinEntry({
  roundId,
  flightId,
  holeNumber,
}) {
  if (!roundId || !flightId || !holeNumber) {
    throw new Error(
      "Runde, bold eller hulnummer mangler."
    );
  }

  const { error } = await supabase
    .from("closest_to_pin_entries")
    .delete()
    .eq("round_id", roundId)
    .eq("flight_id", flightId)
    .eq("hole_number", Number(holeNumber));

  if (error) {
    throw error;
  }
}

/**
 * Finder den aktuelle fører på hvert par 3-hul.
 *
 * Den korteste afstand vinder foreløbigt.
 */
export function calculateClosestToPinLeaders(
  entries
) {
  const leadersByHole = new Map();

  (entries ?? []).forEach((entry) => {
    const holeNumber = Number(
      entry.hole_number
    );

    const distance = Number(
      entry.distance_meters
    );

    if (!Number.isFinite(distance)) {
      return;
    }

    const currentLeader =
      leadersByHole.get(holeNumber);

    if (
      !currentLeader ||
      distance <
        Number(
          currentLeader.distance_meters
        )
    ) {
      leadersByHole.set(
        holeNumber,
        entry
      );
    }
  });

  return [...leadersByHole.values()].sort(
    (a, b) =>
      Number(a.hole_number) -
      Number(b.hole_number)
  );
}

/**
 * Realtime-abonnement til alle ændringer
 * i tættest-på-pinden-kandidaterne.
 */
export function subscribeToClosestToPin({
  roundId,
  callback,
}) {
  if (!roundId) {
    throw new Error(
      "Runde-ID mangler ved oprettelse af Realtime."
    );
  }

  const channel = supabase
    .channel(
      `tgt-closest-to-pin-${roundId}`
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "closest_to_pin_entries",
        filter: `round_id=eq.${roundId}`,
      },
      () => {
        callback?.();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}