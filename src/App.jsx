import "./App.css";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import {
  getRoundScores,
  saveHoleScores,
} from "./lib/scores";
import { getLiveRoundLeaderboard } from "./lib/liveLeaderboard";
import { getTeamLeaderboard } from "./lib/teamLeaderboard";
import {
  applyIndividualBonuses,
  sortIndividualLeaderboard,
} from "./lib/individualBonus";
import {
  calculateClosestToPinLeaders,
  deleteClosestToPinEntry,
  getClosestToPinEntries,
  getFlightClosestEntry,
  saveClosestToPinEntry,
} from "./lib/closestToPin";
import {
  getFinalFlightsPreview,
  validateFinalFlightsPreview,
} from "./lib/finalFlights";

function formatScore(score) {
  if (score === null || score === undefined) {
    return "Afventer";
  }

  if (score === 0) {
    return "E";
  }

  return score > 0 ? `+${score}` : String(score);
}

function formatDate(date) {
  if (!date) {
    return "Ikke angivet";
  }

  return new Intl.DateTimeFormat("da-DK", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function formatTime(time) {
  if (!time) {
    return "Ikke angivet";
  }

  return time.slice(0, 5);
}

function sortStandings(data) {
  return [...(data ?? [])].sort((a, b) => {
    const aQualified = a.counting_rounds === 4;
    const bQualified = b.counting_rounds === 4;

    if (aQualified !== bQualified) {
      return aQualified ? -1 : 1;
    }

    if (aQualified && bQualified) {
      if (a.halved_score !== b.halved_score) {
        return (
          (a.halved_score ?? Infinity) -
          (b.halved_score ?? Infinity)
        );
      }
    }

    if (a.counting_score !== b.counting_score) {
      return (
        (a.counting_score ?? Infinity) -
        (b.counting_score ?? Infinity)
      );
    }

    if (a.rounds_played !== b.rounds_played) {
      return b.rounds_played - a.rounds_played;
    }

    return a.player_name.localeCompare(
      b.player_name,
      "da"
    );
  });
}

function Leaderboard({ onOpenLogin }) {
  const [tab, setTab] = useState("season");
  const [standings, setStandings] = useState([]);
  const [liveData, setLiveData] = useState(null);
  const [teamData, setTeamData] = useState(null);
  const [closestEntries, setClosestEntries] = useState([]);
  const [approvedBonuses, setApprovedBonuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const { data, error } = await supabase
        .from("season_individual_standings")
        .select(`
          player_id,
          player_name,
          rounds_played,
          counting_rounds,
          counting_score,
          halved_score
        `)
        .eq("season", 2026);

      if (error) throw error;

      const [currentLiveData, currentTeamData] = await Promise.all([
        getLiveRoundLeaderboard(6),
        getTeamLeaderboard({ season: 2026, roundNumber: 6 }),
      ]);

      const currentClosestEntries = currentLiveData?.round?.id
        ? await getClosestToPinEntries(currentLiveData.round.id)
        : [];

      let currentApprovedBonuses = [];

      if (currentLiveData?.round?.id) {
        const { data: bonusRows, error: bonusError } = await supabase
          .from("closest_to_pin")
          .select(`
            id,
            round_id,
            hole_number,
            player_id,
            bonus_strokes,
            approved
          `)
          .eq("round_id", currentLiveData.round.id)
          .eq("approved", true);

        if (bonusError) throw bonusError;
        currentApprovedBonuses = bonusRows ?? [];
      }

      setStandings(sortStandings(data));
      setLiveData(currentLiveData);
      setTeamData(currentTeamData);
      setClosestEntries(currentClosestEntries);
      setApprovedBonuses(currentApprovedBonuses);
    } catch (error) {
      console.error("Fejl ved hentning af TGT-data:", error);
      setErrorMessage(error.message ?? "Data kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    const channel = supabase
      .channel("tgt-public-leaderboards")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores" },
        loadData
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "closest_to_pin_entries",
        },
        loadData
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "closest_to_pin",
        },
        loadData
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  const liveLeaderboard = sortIndividualLeaderboard(
    applyIndividualBonuses({
      leaderboard: liveData?.leaderboard ?? [],
      approvedBonuses,
    })
  );
  const teamLeaderboard = teamData?.leaderboard ?? [];
  const closestLeaders = calculateClosestToPinLeaders(
    closestEntries
  );
  const parThreeHoles = (liveData?.holes ?? []).filter(
    (hole) => Number(hole.par) === 3
  );

  const headings = {
    season: {
      eyebrow: "Individuel turnering",
      title: "Aktuel sæsonstilling",
      description:
        "De fire laveste rundescores tæller. Den samlede score halveres efter fire tællende runder.",
    },
    live: {
      eyebrow: "Live fra Lübker",
      title: liveData?.round?.name ?? "Runde 6 live",
      description:
        "Bruttoscoren vises i forhold til par og opdateres automatisk, når markørerne gemmer et hul.",
    },
    team: {
      eyebrow: "Best Ball med handicap",
      title: "Holdfinale",
      description:
        "100 % spillehandicap. På hvert hul tæller holdets bedste nettoscore. Hullet tæller først, når begge holdspillere har afleveret score.",
    },
    closest: {
      eyebrow: "Par 3-konkurrencen",
      title: "Tættest på pinden",
      description:
        "Den korteste registrerede afstand på hvert par 3-hul vises som den aktuelle fører.",
    },
  };

  const currentHeading = headings[tab];

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-content">
          <div className="brand-line">
            <span className="flag">⛳</span>
            <span>TGT LIVE</span>
          </div>

          <h1>
            TGT 2026
            <span>Leaderboard</span>
          </h1>

          <p>Sæsonstilling, live-runde og Best Ball-holdfinale</p>

          <button
            type="button"
            onClick={onOpenLogin}
            className="marker-login-button"
          >
            Markør-login
          </button>
        </div>
      </header>

      <main className="main-content">
        <section className="leaderboard-card">
          <div className="tgt-tabs">
            <button
              type="button"
              onClick={() => setTab("season")}
              className={tab === "season" ? "login-submit-button" : "login-cancel-button"}
            >
              Sæsonstilling
            </button>
            <button
              type="button"
              onClick={() => setTab("live")}
              className={tab === "live" ? "login-submit-button" : "login-cancel-button"}
            >
              Runde 6 live
            </button>
            <button
              type="button"
              onClick={() => setTab("team")}
              className={tab === "team" ? "login-submit-button" : "login-cancel-button"}
            >
              Holdfinale
            </button>
            <button
              type="button"
              onClick={() => setTab("closest")}
              className={tab === "closest" ? "login-submit-button" : "login-cancel-button"}
            >
              Tættest på pinden
            </button>
          </div>

          <div className="card-header">
            <div>
              <p className="eyebrow">{currentHeading.eyebrow}</p>
              <h2>{currentHeading.title}</h2>
              <p className="description">{currentHeading.description}</p>
            </div>
            <div className="live-badge">
              <span className="live-dot" /> LIVE
            </div>
          </div>

          {loading && <div className="status-box">Henter TGT-data...</div>}

          {!loading && errorMessage && (
            <div className="error-box">
              <strong>Data kunne ikke hentes</strong>
              <span>{errorMessage}</span>
            </div>
          )}

          {!loading && !errorMessage && tab === "season" && (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th className="position-column">Placering</th>
                    <th>Spiller</th>
                    <th className="number-column">Spillet</th>
                    <th className="number-column">Tæller</th>
                    <th className="number-column">Bedste 4</th>
                    <th className="number-column">Halveret</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((player, index) => (
                    <tr key={player.player_id}>
                      <td className="position-column">
                        <span className={`position-badge position-${index + 1}`}>
                          {index + 1}
                        </span>
                      </td>
                      <td><span className="player-name">{player.player_name}</span></td>
                      <td className="number-column">{player.rounds_played}</td>
                      <td className="number-column">{player.counting_rounds} / 4</td>
                      <td className="number-column score">{formatScore(player.counting_score)}</td>
                      <td className="number-column final-score">{formatScore(player.halved_score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !errorMessage && tab === "live" && (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th className="position-column">Placering</th>
                    <th>Spiller</th>
                    <th className="number-column">Thru</th>
                    <th className="number-column">Brutto</th>
                    <th className="number-column">Bonus</th>
                    <th className="number-column">Officiel</th>
                  </tr>
                </thead>
                <tbody>
                  {liveLeaderboard.map((player, index) => (
                    <tr key={player.playerId}>
                      <td className="position-column">
                        <span className={`position-badge position-${index + 1}`}>
                          {index + 1}
                        </span>
                      </td>
                      <td>
                        <span className="player-name">{player.playerName}</span>
                        <small style={{ display: "block", color: "#78827d" }}>
                          Handicap: {player.handicap ?? "Ikke angivet"}
                        </small>
                      </td>
                      <td className="number-column">{player.holesPlayed}</td>
                      <td className="number-column score">
                        {player.holesPlayed === 0
                          ? "Ikke startet"
                          : formatScore(player.scoreToPar)}
                      </td>
                      <td className="number-column">
                        {player.earnedBonus > 0
                          ? player.hasCompletedRound
                            ? `-${player.appliedBonus}`
                            : `${player.earnedBonus} afventer`
                          : "–"}
                      </td>
                      <td className="number-column final-score">
                        {player.holesPlayed === 0
                          ? "Ikke startet"
                          : formatScore(player.officialToPar)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {liveLeaderboard.length === 0 && (
                <div className="status-box">Der er ingen deltagere i Runde 6.</div>
              )}
            </div>
          )}

          {!loading && !errorMessage && tab === "team" && (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th className="position-column">Placering</th>
                    <th>Hold</th>
                    <th className="number-column">Thru</th>
                    <th className="number-column">Best Ball netto</th>
                  </tr>
                </thead>
                <tbody>
                  {teamLeaderboard.map((team, index) => (
                    <tr key={team.teamId}>
                      <td className="position-column">
                        <span className={`position-badge position-${index + 1}`}>
                          {index + 1}
                        </span>
                      </td>
                      <td>
                        <span className="player-name">{team.teamName}</span>
                        <small style={{ display: "block", color: "#78827d" }}>
                          {team.players.map((player) =>
                            `${player.playerName} · PHCP ${player.playingHandicap}`
                          ).join(" | ")}
                        </small>
                      </td>
                      <td className="number-column">{team.holesPlayed}</td>
                      <td className="number-column final-score">
                        {team.holesPlayed === 0 ? "Ikke startet" : formatScore(team.netToPar)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {teamLeaderboard.length === 0 && (
                <div className="status-box">
                  Ingen gyldige hold kunne beregnes. Kontrollér, at hvert hold har præcis to spillere og spillehandicap på Runde 6.
                </div>
              )}
            </div>
          )}

          {!loading && !errorMessage && tab === "closest" && (
            <div style={{ padding: 20 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 14,
                }}
              >
                {parThreeHoles.map((hole) => {
                  const leader = closestLeaders.find(
                    (entry) =>
                      Number(entry.hole_number) ===
                      Number(hole.hole_number)
                  );

                  return (
                    <article
                      key={hole.hole_number}
                      style={{
                        padding: 18,
                        border: "1px solid #e0e8e2",
                        borderRadius: 16,
                        background: leader ? "#f1f8f3" : "#fafbf9",
                      }}
                    >
                      <p className="eyebrow">
                        Hul {hole.hole_number} · Par {hole.par}
                      </p>

                      {leader ? (
                        <>
                          <h3 style={{ margin: "5px 0" }}>
                            {leader.players?.name ?? "Ukendt spiller"}
                          </h3>
                          <div
                            className="final-score"
                            style={{ marginTop: 8 }}
                          >
                            {Number(leader.distance_meters).toLocaleString(
                              "da-DK",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }
                            )} meter
                          </div>
                          <small
                            style={{
                              display: "block",
                              marginTop: 8,
                              color: "#78827d",
                            }}
                          >
                            {leader.flights?.name ?? "Bold ikke angivet"}
                          </small>
                        </>
                      ) : (
                        <div className="status-box" style={{ margin: "12px 0 0" }}>
                          Afventer første kandidat
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              {parThreeHoles.length === 0 && (
                <div className="status-box">
                  Der blev ikke fundet par 3-huller på banen.
                </div>
              )}
            </div>
          )}

          <div className="card-footer">
            <span>Data hentes direkte fra TGT-databasen</span>
            <span>Sæson 2026</span>
          </div>
        </section>
      </main>
    </div>
  );
}

function MarkerLogin({
  onCancel,
  onLoginSuccess,
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");

  async function handleLogin(event) {
    event.preventDefault();

    setLoggingIn(true);
    setLoginError("");

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

    if (error) {
      console.error("Loginfejl:", error);

      setLoginError(
        "Login mislykkedes. Kontrollér boldens mail og adgangskode."
      );

      setLoggingIn(false);
      return;
    }

    setLoggingIn(false);
    onLoginSuccess(data.session);
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-icon">⛳</div>

        <p className="eyebrow">TGT 2026</p>

        <h1>Markør- og admin-login</h1>

        <p className="description">
          Log ind med boldens login eller din administratorbruger.
        </p>

        <form onSubmit={handleLogin}>
          <label className="form-label">
            Boldens mailadresse
          </label>

          <input
            type="email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            placeholder="bold1@tgt.dk"
            autoComplete="username"
            required
            className="form-input"
          />

          <label className="form-label">
            Adgangskode
          </label>

          <input
            type="password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            placeholder="Indtast adgangskode"
            autoComplete="current-password"
            required
            className="form-input"
          />

          {loginError && (
            <div className="error-box">
              {loginError}
            </div>
          )}

          <button
            type="submit"
            disabled={loggingIn}
            className="login-submit-button"
          >
            {loggingIn
              ? "Logger ind..."
              : "Log ind som markør"}
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="login-cancel-button"
          >
            Tilbage til leaderboard
          </button>
        </form>
      </section>
    </main>
  );
}

function AdminClosestToPin({ session, onLogout }) {
  const [roundId, setRoundId] = useState(null);
  const [approvedWinners, setApprovedWinners] = useState([]);
  const [finalPreview, setFinalPreview] = useState(null);
  const [previewValidation, setPreviewValidation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [creatingFlights, setCreatingFlights] = useState(false);
  const [flightsCreated, setFlightsCreated] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const { data: round, error: roundError } = await supabase
        .from("rounds")
        .select(`
          id,
          round_number,
          name,
          played_at,
          tournaments!inner (
            season
          )
        `)
        .eq("tournaments.season", 2026)
        .eq("round_number", 6)
        .single();

      if (roundError) throw roundError;
      setRoundId(round.id);

      const { data: winners, error: winnersError } = await supabase
        .from("closest_to_pin")
        .select(`
          id,
          hole_number,
          distance_meters,
          bonus_strokes,
          approved,
          players (
            id,
            name
          )
        `)
        .eq("round_id", round.id)
        .eq("approved", true)
        .order("hole_number", { ascending: true });

      if (winnersError) throw winnersError;
      setApprovedWinners(winners ?? []);
    } catch (error) {
      console.error("Fejl ved hentning af admindata:", error);
      setErrorMessage(
        error.message ?? "Admindata kunne ikke hentes."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  async function handleFinalizeClosestToPin() {
    if (!roundId) return;

    setFinalizing(true);
    setMessage("");
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc(
        "finalize_closest_to_pin",
        { requested_round_id: roundId }
      );

      if (error) throw error;

      setMessage(
        `${data ?? 0} tættest-på-pinden-vindere er godkendt.`
      );
      await loadAdminData();
    } catch (error) {
      console.error("Fejl ved godkendelse af vindere:", error);
      setErrorMessage(
        error.message ?? "Vinderne kunne ikke godkendes."
      );
    } finally {
      setFinalizing(false);
    }
  }

  async function handleLoadFinalPreview() {
    setLoadingPreview(true);
    setMessage("");
    setErrorMessage("");

    try {
      const preview = await getFinalFlightsPreview({
        season: 2026,
        sourceRoundNumber: 6,
        finalRoundNumber: 7,
      });

      setFinalPreview(preview);
      setPreviewValidation(
        validateFinalFlightsPreview(preview)
      );
    } catch (error) {
      console.error("Fejl ved forhåndsvisning af finalebolde:", error);
      setFinalPreview(null);
      setPreviewValidation(null);
      setErrorMessage(
        error.message ?? "Finaleboldene kunne ikke beregnes."
      );
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleCreateFinalFlights() {
    if (
      !finalPreview?.finalRound?.id ||
      !previewValidation?.valid ||
      !finalPreview.canGenerate
    ) {
      setErrorMessage(
        "Finaleboldene kan ikke oprettes, før alle kontroller er godkendt."
      );
      return;
    }

    const confirmed = window.confirm(
      "Vil du oprette finaleboldene i Runde 7? En eksisterende fordeling i Runde 7 bliver erstattet."
    );

    if (!confirmed) return;

    setCreatingFlights(true);
    setFlightsCreated(false);
    setMessage("");
    setErrorMessage("");

    try {
      const assignments = finalPreview.flights.flatMap((flight) =>
        flight.players.map((player) => ({
          player_id: player.playerId,
          flight_number: flight.flightNumber,
          playing_order: player.playingOrder,
        }))
      );

      const { data, error } = await supabase.rpc(
        "create_final_flights",
        {
          requested_final_round_id: finalPreview.finalRound.id,
          assignments,
        }
      );

      if (error) throw error;

      setFlightsCreated(true);
      setMessage(
        `${data ?? 0} spillere er oprettet i finaleboldene på Runde 7.`
      );
    } catch (error) {
      console.error("Fejl ved oprettelse af finalebolde:", error);
      setErrorMessage(
        error.message ?? "Finaleboldene kunne ikke oprettes."
      );
    } finally {
      setCreatingFlights(false);
    }
  }

  return (
    <main className="marker-page">
      <section className="marker-card">
        <div className="marker-header">
          <div>
            <p className="eyebrow">TGT administration</p>
            <h1>Finaleadministration</h1>
            <p className="description">
              Godkend tættest på pinden og kontrollér den beregnede
              finalestilling, før spillerne senere oprettes i Runde 7.
            </p>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="logout-button"
          >
            Log ud
          </button>
        </div>

        {loading && (
          <div className="status-box">Henter admindata...</div>
        )}

        {!loading && errorMessage && (
          <div className="error-box">
            <strong>Handlingen kunne ikke gennemføres</strong>
            <span>{errorMessage}</span>
          </div>
        )}

        {!loading && (
          <div style={{ padding: 22 }}>
            <section
              style={{
                padding: 20,
                border: "1px solid #e0e8e2",
                borderRadius: 16,
                background: "#f8faf8",
              }}
            >
              <p className="eyebrow">Par 3-konkurrencen</p>
              <h2 style={{ marginTop: 0 }}>Tættest på pinden</h2>

              <button
                type="button"
                onClick={handleFinalizeClosestToPin}
                disabled={finalizing || !roundId}
                className="login-submit-button"
                style={{ maxWidth: 360, marginTop: 8 }}
              >
                {finalizing
                  ? "Godkender vindere..."
                  : "Godkend tættest på pinden"}
              </button>

              {approvedWinners.length === 0 ? (
                <div className="status-box" style={{ margin: "16px 0 0" }}>
                  Der er endnu ingen godkendte vindere.
                </div>
              ) : (
                <div className="table-wrapper" style={{ marginTop: 16 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Hul</th>
                        <th>Spiller</th>
                        <th className="number-column">Afstand</th>
                        <th className="number-column">Bonus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvedWinners.map((winner) => (
                        <tr key={winner.id}>
                          <td>Hul {winner.hole_number}</td>
                          <td>
                            <span className="player-name">
                              {winner.players?.name ?? "Ukendt spiller"}
                            </span>
                          </td>
                          <td className="number-column">
                            {Number(winner.distance_meters).toLocaleString(
                              "da-DK",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }
                            )} meter
                          </td>
                          <td className="number-column final-score">
                            -{winner.bonus_strokes} slag
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section
              style={{
                marginTop: 24,
                padding: 20,
                border: "1px solid #d8e4db",
                borderRadius: 16,
                background: "#ffffff",
              }}
            >
              <p className="eyebrow">12. september 2026</p>
              <h2 style={{ marginTop: 0 }}>Forhåndsvis finalebolde</h2>
              <p className="description">
                Visningen skriver ikke noget til Runde 7. Den beregner kun
                placeringerne og kontrollerer, om alle 15 spillere er klar.
              </p>

              <button
                type="button"
                onClick={handleLoadFinalPreview}
                disabled={loadingPreview}
                className="login-submit-button"
                style={{ maxWidth: 360 }}
              >
                {loadingPreview
                  ? "Beregner finalebolde..."
                  : "Beregn og vis finalebolde"}
              </button>

              {finalPreview && (
                <>
                  <div className="flight-information" style={{ marginTop: 18 }}>
                    <div>
                      <span>Spillere</span>
                      <strong>{finalPreview.standings.length}</strong>
                    </div>
                    <div>
                      <span>Gennemført Runde 6</span>
                      <strong>{finalPreview.completedPlayers} / 15</strong>
                    </div>
                    <div>
                      <span>Validering</span>
                      <strong>
                        {previewValidation?.valid ? "Klar" : "Afventer"}
                      </strong>
                    </div>
                    <div>
                      <span>Kan oprettes</span>
                      <strong>{finalPreview.canGenerate ? "Ja" : "Nej"}</strong>
                    </div>
                  </div>

                  {!previewValidation?.valid && (
                    <div className="error-box" style={{ margin: "18px 0 0" }}>
                      <strong>Finaleboldene kan ikke godkendes endnu</strong>
                      {(previewValidation?.errors ?? []).map((error) => (
                        <span key={error}>{error}</span>
                      ))}
                    </div>
                  )}

                  <h2 style={{ marginTop: 28 }}>Foreløbig finalestilling</h2>
                  <div className="table-wrapper" style={{ marginTop: 12 }}>
                    <table>
                      <thead>
                        <tr>
                          <th className="position-column">Placering</th>
                          <th>Spiller</th>
                          <th className="number-column">Udgangspunkt</th>
                          <th className="number-column">Runde 6</th>
                          <th className="number-column">Samlet</th>
                          <th className="number-column">Thru</th>
                        </tr>
                      </thead>
                      <tbody>
                        {finalPreview.standings.map((player) => (
                          <tr key={player.playerId}>
                            <td className="position-column">
                              <span
                                className={`position-badge position-${player.position}`}
                              >
                                {player.position}
                              </span>
                            </td>
                            <td>
                              <span className="player-name">
                                {player.playerName}
                              </span>
                            </td>
                            <td className="number-column">
                              {formatScore(player.startingScore)}
                            </td>
                            <td className="number-column">
                              {player.holesPlayed === 0
                                ? "Ikke startet"
                                : formatScore(player.officialRoundScore)}
                            </td>
                            <td className="number-column final-score">
                              {player.finalScore === null
                                ? "Afventer"
                                : formatScore(player.finalScore)}
                            </td>
                            <td className="number-column">
                              {player.holesPlayed}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <h2 style={{ marginTop: 30 }}>Finalebolde</h2>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(250px, 1fr))",
                      gap: 14,
                      marginTop: 14,
                    }}
                  >
                    {finalPreview.flights.map((flight) => (
                      <article
                        key={flight.flightNumber}
                        style={{
                          padding: 18,
                          border: "1px solid #e0e8e2",
                          borderRadius: 16,
                          background:
                            flight.flightNumber === 4
                              ? "#eef7f0"
                              : "#fafbf9",
                        }}
                      >
                        <p className="eyebrow">
                          Placering {flight.firstPosition} til {flight.lastPosition}
                        </p>
                        <h3 style={{ margin: "5px 0 12px" }}>
                          {flight.flightName}
                        </h3>

                        {flight.players.map((player) => (
                          <div
                            key={player.playerId}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              padding: "9px 0",
                              borderTop: "1px solid #e7ece8",
                            }}
                          >
                            <span>
                              {player.playingOrder}. {player.playerName}
                            </span>
                            <strong>
                              {player.finalScore === null
                                ? "Afventer"
                                : formatScore(player.finalScore)}
                            </strong>
                          </div>
                        ))}
                      </article>
                    ))}
                  </div>

                  <div className="status-box" style={{ margin: "22px 0 0" }}>
                    {flightsCreated
                      ? "Finaleboldene er oprettet i Runde 7."
                      : "Dette er kun en forhåndsvisning. Ingen spillere er endnu oprettet i finaleboldene på Runde 7."}
                  </div>

                  <button
                    type="button"
                    onClick={handleCreateFinalFlights}
                    disabled={
                      creatingFlights ||
                      !previewValidation?.valid ||
                      !finalPreview.canGenerate
                    }
                    className="login-submit-button"
                    style={{ maxWidth: 420, marginTop: 16 }}
                  >
                    {creatingFlights
                      ? "Opretter finalebolde..."
                      : flightsCreated
                        ? "Finalebolde er oprettet"
                        : "Godkend og opret finalebolde"}
                  </button>
                </>
              )}
            </section>

            {message && (
              <div
                style={{
                  marginTop: 16,
                  padding: 14,
                  borderRadius: 10,
                  background: "#e7f6eb",
                  color: "#176334",
                  fontWeight: 700,
                }}
              >
                {message}
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function MarkerDashboard({
  session,
  onLogout,
}) {
  const [assignment, setAssignment] = useState(null);
  const [players, setPlayers] = useState([]);
  const [holes, setHoles] = useState([]);
  const [existingScores, setExistingScores] =
    useState([]);

  const [selectedHole, setSelectedHole] = useState(1);
  const [draftScores, setDraftScores] = useState({});

  const [loading, setLoading] = useState(true);
  const [assignmentError, setAssignmentError] =
    useState("");

  const [savingScores, setSavingScores] =
    useState(false);

  const [saveMessage, setSaveMessage] =
    useState("");

  const [saveError, setSaveError] =
    useState("");

  const [closestPlayerId, setClosestPlayerId] =
    useState("");
  const [closestDistance, setClosestDistance] =
    useState("");
  const [closestEntry, setClosestEntry] =
    useState(null);
  const [closestLoading, setClosestLoading] =
    useState(false);
  const [closestMessage, setClosestMessage] =
    useState("");
  const [closestError, setClosestError] =
    useState("");

  async function loadScores(
    roundId,
    loadedPlayers
  ) {
    const playerIds = loadedPlayers.map(
      (player) => player.id
    );

    const scoreRows = await getRoundScores(
      roundId,
      playerIds
    );

    setExistingScores(scoreRows);

    const scoreMap = {};

    scoreRows.forEach((score) => {
      scoreMap[
        `${score.player_id}-${score.hole_number}`
      ] = score.strokes;
    });

    setDraftScores(scoreMap);
  }

  useEffect(() => {
    async function loadMarkerFlight() {
      setLoading(true);
      setAssignmentError("");

      const {
        data: markerRows,
        error: markerError,
      } = await supabase
        .from("flight_markers")
        .select(`
          flight_id,
          active,
          flights (
            id,
            name,
            flight_number,
            tee_time,
            status,
            round_id,
            rounds (
              id,
              round_number,
              name,
              played_at,
              course_id
            )
          )
        `)
        .eq("user_id", session.user.id)
        .eq("active", true);

      if (markerError) {
        console.error(
          "Fejl ved hentning af markørbold:",
          markerError
        );

        setAssignmentError(markerError.message);
        setLoading(false);
        return;
      }

      const markerAssignment = markerRows?.find(
        (row) =>
          row.flights?.rounds?.round_number === 6
      );

      if (!markerAssignment?.flights) {
        setAssignmentError(
          "Dette login er ikke knyttet til en bold i runde 6."
        );

        setLoading(false);
        return;
      }

      const flight = markerAssignment.flights;

      setAssignment(flight);

      const {
        data: flightPlayerRows,
        error: playerError,
      } = await supabase
        .from("flight_players")
        .select(`
          playing_order,
          player_id,
          players (
            id,
            name,
            handicap_index
          )
        `)
        .eq("flight_id", flight.id)
        .order("playing_order", {
          ascending: true,
        });

      if (playerError) {
        console.error(
          "Fejl ved hentning af boldens spillere:",
          playerError
        );

        setAssignmentError(playerError.message);
        setLoading(false);
        return;
      }

      const loadedPlayers = (
        flightPlayerRows ?? []
      )
        .map((row) => ({
          playingOrder: row.playing_order,
          id: row.players?.id,
          name: row.players?.name,
          handicap:
            row.players?.handicap_index,
        }))
        .filter((player) => player.id);

      setPlayers(loadedPlayers);

      const courseId =
        flight.rounds?.course_id;

      if (!courseId) {
        setAssignmentError(
          "Runden har ikke en golfbane tilknyttet."
        );

        setLoading(false);
        return;
      }

      const {
        data: holeRows,
        error: holeError,
      } = await supabase
        .from("course_holes")
        .select(`
          id,
          hole_number,
          par,
          stroke_index
        `)
        .eq("course_id", courseId)
        .order("hole_number", {
          ascending: true,
        });

      if (holeError) {
        console.error(
          "Fejl ved hentning af scorekort:",
          holeError
        );

        setAssignmentError(holeError.message);
        setLoading(false);
        return;
      }

      setHoles(holeRows ?? []);

      try {
        await loadScores(
          flight.round_id,
          loadedPlayers
        );
      } catch (scoreError) {
        console.error(
          "Fejl ved hentning af scores:",
          scoreError
        );

        setAssignmentError(scoreError.message);
        setLoading(false);
        return;
      }

      setLoading(false);
    }

    loadMarkerFlight();
  }, [session.user.id]);

  function handleScoreChange(
    playerId,
    value
  ) {
    setSaveMessage("");
    setSaveError("");

    setDraftScores((currentScores) => ({
      ...currentScores,

      [`${playerId}-${selectedHole}`]:
        value === "" ? "" : Number(value),
    }));
  }

  async function handleSaveHole() {
    if (!assignment) {
      return;
    }

    setSavingScores(true);
    setSaveMessage("");
    setSaveError("");

    const scoresToSave = players.map(
      (player) => ({
        playerId: player.id,

        strokes:
          draftScores[
            `${player.id}-${selectedHole}`
          ] ?? "",
      })
    );

    const missingPlayers = scoresToSave.filter(
      (score) =>
        score.strokes === "" ||
        score.strokes === null ||
        score.strokes === undefined
    );

    if (missingPlayers.length > 0) {
      setSaveError(
        "Indtast en score for alle spillere i bolden."
      );

      setSavingScores(false);
      return;
    }

    try {
      await saveHoleScores({
        roundId: assignment.round_id,
        holeNumber: selectedHole,
        scores: scoresToSave,
      });

      setSaveMessage(
        `Hul ${selectedHole} er gemt for hele bolden.`
      );

      await loadScores(
        assignment.round_id,
        players
      );

      if (
        selectedHole < 18 &&
        holes.length >= selectedHole + 1
      ) {
        setSelectedHole(
          (currentHole) => currentHole + 1
        );
      }
    } catch (error) {
      console.error(
        "Fejl ved gemning af scores:",
        error
      );

      setSaveError(
        error.message ??
          "Scorerne kunne ikke gemmes."
      );
    } finally {
      setSavingScores(false);
    }
  }

  const selectedHoleData = holes.find(
    (hole) =>
      hole.hole_number === selectedHole
  );

  const isClosestToPinHole =
    selectedHoleData?.par === 3;

  useEffect(() => {
    async function loadClosestEntry() {
      setClosestMessage("");
      setClosestError("");

      if (
        !assignment?.round_id ||
        !assignment?.id ||
        !isClosestToPinHole
      ) {
        setClosestEntry(null);
        setClosestPlayerId("");
        setClosestDistance("");
        return;
      }

      setClosestLoading(true);

      try {
        const entry = await getFlightClosestEntry({
          roundId: assignment.round_id,
          flightId: assignment.id,
          holeNumber: selectedHole,
        });

        setClosestEntry(entry);
        setClosestPlayerId(entry?.player_id ?? "");
        setClosestDistance(
          entry?.distance_meters ?? ""
        );
      } catch (error) {
        console.error(
          "Fejl ved hentning af tættest på pinden:",
          error
        );
        setClosestError(
          error.message ??
            "Registreringen kunne ikke hentes."
        );
      } finally {
        setClosestLoading(false);
      }
    }

    loadClosestEntry();
  }, [
    assignment?.round_id,
    assignment?.id,
    selectedHole,
    isClosestToPinHole,
  ]);

  async function handleSaveClosest() {
    if (!assignment || !isClosestToPinHole) {
      return;
    }

    setClosestLoading(true);
    setClosestMessage("");
    setClosestError("");

    try {
      const entry = await saveClosestToPinEntry({
        roundId: assignment.round_id,
        flightId: assignment.id,
        holeNumber: selectedHole,
        playerId: closestPlayerId,
        distanceMeters: closestDistance,
      });

      setClosestEntry(entry);
      setClosestMessage(
        `Kandidat på hul ${selectedHole} er gemt.`
      );
    } catch (error) {
      console.error(
        "Fejl ved gemning af tættest på pinden:",
        error
      );
      setClosestError(
        error.message ??
          "Registreringen kunne ikke gemmes."
      );
    } finally {
      setClosestLoading(false);
    }
  }

  async function handleDeleteClosest() {
    if (!assignment || !closestEntry) {
      return;
    }

    setClosestLoading(true);
    setClosestMessage("");
    setClosestError("");

    try {
      await deleteClosestToPinEntry({
        roundId: assignment.round_id,
        flightId: assignment.id,
        holeNumber: selectedHole,
      });

      setClosestEntry(null);
      setClosestPlayerId("");
      setClosestDistance("");
      setClosestMessage(
        `Kandidaten på hul ${selectedHole} er slettet.`
      );
    } catch (error) {
      console.error(
        "Fejl ved sletning af tættest på pinden:",
        error
      );
      setClosestError(
        error.message ??
          "Registreringen kunne ikke slettes."
      );
    } finally {
      setClosestLoading(false);
    }
  }

  const completedHoles = holes.filter(
    (hole) =>
      players.length > 0 &&
      players.every((player) => {
        const savedScore =
          existingScores.find(
            (score) =>
              score.player_id === player.id &&
              score.hole_number ===
                hole.hole_number
          );

        return Boolean(savedScore);
      })
  ).length;

  return (
    <main className="marker-page">
      <section className="marker-card">
        <div className="marker-header">
          <div>
            <p className="eyebrow">
              TGT markørområde
            </p>

            <h1>
              {assignment?.name ??
                "Henter bold..."}
            </h1>

            <p className="description">
              Logget ind som {session.user.email}
            </p>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="logout-button"
          >
            Log ud
          </button>
        </div>

        {loading && (
          <div className="status-box">
            Henter bold, spillere og scorekort...
          </div>
        )}

        {!loading && assignmentError && (
          <div className="error-box">
            <strong>
              Bolden kunne ikke hentes
            </strong>

            <span>{assignmentError}</span>
          </div>
        )}

        {!loading &&
          !assignmentError &&
          assignment && (
            <>
              <div className="flight-information">
                <div>
                  <span>Runde</span>

                  <strong>
                    {
                      assignment.rounds
                        ?.round_number
                    }
                  </strong>
                </div>

                <div>
                  <span>Dato</span>

                  <strong>
                    {formatDate(
                      assignment.rounds
                        ?.played_at
                    )}
                  </strong>
                </div>

                <div>
                  <span>Starttid</span>

                  <strong>
                    {formatTime(
                      assignment.tee_time
                    )}
                  </strong>
                </div>

                <div>
                  <span>Gemt</span>

                  <strong>
                    {completedHoles} / 18 huller
                  </strong>
                </div>
              </div>

              <section
                style={{
                  marginTop: 28,
                  padding: 20,
                  border:
                    "1px solid rgba(16, 72, 51, 0.2)",
                  borderRadius: 18,
                  background: "#f7faf7",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent:
                      "space-between",
                    alignItems: "center",
                    gap: 16,
                  }}
                >
                  <div>
                    <p className="eyebrow">
                      Live scoreindtastning
                    </p>

                    <h2
                      style={{
                        margin: "4px 0",
                      }}
                    >
                      Hul {selectedHole}
                    </h2>

                    <p
                      style={{
                        margin: 0,
                        color: "#68756f",
                      }}
                    >
                      Par{" "}
                      {selectedHoleData?.par ??
                        "–"}
                      {" · "}
                      Index{" "}
                      {selectedHoleData
                        ?.stroke_index ?? "–"}
                    </p>
                  </div>

                  <select
                    value={selectedHole}
                    onChange={(event) => {
                      setSelectedHole(
                        Number(event.target.value)
                      );

                      setSaveMessage("");
                      setSaveError("");
                    }}
                    style={{
                      minWidth: 140,
                      padding: 12,
                      borderRadius: 10,
                      border:
                        "1px solid #cfd9d2",
                      background: "white",
                      fontWeight: 700,
                    }}
                  >
                    {holes.map((hole) => (
                      <option
                        key={hole.hole_number}
                        value={hole.hole_number}
                      >
                        Hul {hole.hole_number}
                        {" · "}
                        Par {hole.par}
                      </option>
                    ))}
                  </select>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 12,
                    marginTop: 20,
                  }}
                >
                  {players.map((player) => {
                    const scoreKey =
                      `${player.id}-${selectedHole}`;

                    return (
                      <label
                        key={player.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "48px 1fr 90px",
                          alignItems: "center",
                          gap: 12,
                          padding: 14,
                          borderRadius: 12,
                          background: "white",
                          border:
                            "1px solid #e3e9e5",
                        }}
                      >
                        <span
                          style={{
                            display: "grid",
                            placeItems: "center",
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            background: "#e8f0e9",
                            fontWeight: 800,
                          }}
                        >
                          {player.playingOrder}
                        </span>

                        <span>
                          <strong
                            style={{
                              display: "block",
                            }}
                          >
                            {player.name}
                          </strong>

                          <small
                            style={{
                              color: "#78827d",
                            }}
                          >
                            Handicap:{" "}
                            {player.handicap ??
                              "Ikke angivet"}
                          </small>
                        </span>

                        <input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          max="20"
                          value={
                            draftScores[
                              scoreKey
                            ] ?? ""
                          }
                          onChange={(event) =>
                            handleScoreChange(
                              player.id,
                              event.target.value
                            )
                          }
                          placeholder="Slag"
                          style={{
                            width: "100%",
                            padding: 12,
                            borderRadius: 10,
                            border:
                              "1px solid #bdc9c1",
                            textAlign: "center",
                            fontSize: 18,
                            fontWeight: 800,
                          }}
                        />
                      </label>
                    );
                  })}
                </div>

                {isClosestToPinHole && (
                  <section
                    style={{
                      marginTop: 20,
                      padding: 18,
                      borderRadius: 14,
                      border: "1px solid #d7e5da",
                      background: "#eef7f0",
                    }}
                  >
                    <p className="eyebrow">
                      Tættest på pinden
                    </p>
                    <h3 style={{ margin: "4px 0 8px" }}>
                      Boldens kandidat på hul {selectedHole}
                    </h3>
                    <p
                      style={{
                        margin: "0 0 16px",
                        color: "#68756f",
                      }}
                    >
                      Registrér kun boldens bedste spiller,
                      hvis mindst én bold ligger på green.
                    </p>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "minmax(180px, 1fr) minmax(130px, 180px)",
                        gap: 12,
                      }}
                    >
                      <select
                        value={closestPlayerId}
                        onChange={(event) => {
                          setClosestPlayerId(
                            event.target.value
                          );
                          setClosestMessage("");
                          setClosestError("");
                        }}
                        disabled={closestLoading}
                        style={{
                          width: "100%",
                          padding: 12,
                          borderRadius: 10,
                          border: "1px solid #bdc9c1",
                          background: "white",
                        }}
                      >
                        <option value="">
                          Vælg spiller
                        </option>
                        {players.map((player) => (
                          <option
                            key={player.id}
                            value={player.id}
                          >
                            {player.name}
                          </option>
                        ))}
                      </select>

                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={closestDistance}
                        onChange={(event) => {
                          setClosestDistance(
                            event.target.value
                          );
                          setClosestMessage("");
                          setClosestError("");
                        }}
                        disabled={closestLoading}
                        placeholder="Meter, fx 1.42"
                        style={{
                          width: "100%",
                          padding: 12,
                          borderRadius: 10,
                          border: "1px solid #bdc9c1",
                          background: "white",
                        }}
                      />
                    </div>

                    {closestError && (
                      <div
                        className="error-box"
                        style={{ margin: "14px 0 0" }}
                      >
                        {closestError}
                      </div>
                    )}

                    {closestMessage && (
                      <div
                        style={{
                          marginTop: 14,
                          padding: 12,
                          borderRadius: 10,
                          background: "#e1f2e5",
                          color: "#176334",
                          fontWeight: 700,
                        }}
                      >
                        {closestMessage}
                      </div>
                    )}

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          closestEntry ? "1fr 1fr" : "1fr",
                        gap: 10,
                        marginTop: 14,
                      }}
                    >
                      <button
                        type="button"
                        onClick={handleSaveClosest}
                        disabled={
                          closestLoading ||
                          !closestPlayerId ||
                          closestDistance === ""
                        }
                        className="login-submit-button"
                        style={{ marginTop: 0 }}
                      >
                        {closestLoading
                          ? "Gemmer..."
                          : closestEntry
                            ? "Opdatér kandidat"
                            : "Gem kandidat"}
                      </button>

                      {closestEntry && (
                        <button
                          type="button"
                          onClick={handleDeleteClosest}
                          disabled={closestLoading}
                          className="login-cancel-button"
                          style={{ marginTop: 0 }}
                        >
                          Slet kandidat
                        </button>
                      )}
                    </div>
                  </section>
                )}

                {saveError && (
                  <div
                    className="error-box"
                    style={{
                      marginTop: 16,
                    }}
                  >
                    {saveError}
                  </div>
                )}

                {saveMessage && (
                  <div
                    style={{
                      marginTop: 16,
                      padding: 14,
                      borderRadius: 10,
                      background: "#e7f6eb",
                      color: "#176334",
                      fontWeight: 700,
                    }}
                  >
                    {saveMessage}
                  </div>
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap: 12,
                    marginTop: 20,
                  }}
                >
                  <button
                    type="button"
                    disabled={selectedHole <= 1}
                    onClick={() =>
                      setSelectedHole(
                        (currentHole) =>
                          Math.max(
                            1,
                            currentHole - 1
                          )
                      )
                    }
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border:
                        "1px solid #cbd5ce",
                      background: "white",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Forrige hul
                  </button>

                  <button
                    type="button"
                    disabled={savingScores}
                    onClick={handleSaveHole}
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border: 0,
                      background: "#0b4935",
                      color: "white",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    {savingScores
                      ? "Gemmer..."
                      : `Gem hul ${selectedHole}`}
                  </button>
                </div>
              </section>
            </>
          )}
      </section>
    </main>
  );
}

export default function App() {
  const [session, setSession] =
    useState(null);

  const [
    checkingSession,
    setCheckingSession,
  ] = useState(true);

  const [showLogin, setShowLogin] =
    useState(false);

  useEffect(() => {
    async function getInitialSession() {
      const { data } =
        await supabase.auth.getSession();

      setSession(data.session ?? null);
      setCheckingSession(false);
    }

    getInitialSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, currentSession) => {
        setSession(currentSession);
        setCheckingSession(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();

    setSession(null);
    setShowLogin(false);
  }

  if (checkingSession) {
    return (
      <main className="login-page">
        <div className="status-box">
          Starter TGT Live...
        </div>
      </main>
    );
  }

  if (session) {
    const isAdmin =
      session.user.email?.toLowerCase() ===
      "kasper.vang@soderbergpartners.dk";

    if (isAdmin) {
      return (
        <AdminClosestToPin
          session={session}
          onLogout={handleLogout}
        />
      );
    }

    return (
      <MarkerDashboard
        session={session}
        onLogout={handleLogout}
      />
    );
  }

  if (showLogin) {
    return (
      <MarkerLogin
        onCancel={() =>
          setShowLogin(false)
        }
        onLoginSuccess={(newSession) => {
          setSession(newSession);
          setShowLogin(false);
        }}
      />
    );
  }

  return (
    <Leaderboard
      onOpenLogin={() =>
        setShowLogin(true)
      }
    />
  );
}