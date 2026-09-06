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
import { getFinalStandings } from "./lib/finalStandings";
import { getFormattedHallOfFame } from "./lib/hallOfFame";
import {
  createSeasonPlayer,
  getSeasonPlayers,
  summarizeSeasonPlayers,
  updateSeasonPlayer,
} from "./lib/seasonAdmin";
import {
  createSeasonTeam,
  deactivateAndReleaseTeam,
  getSeasonTeams,
  summarizeSeasonTeams,
  updateSeasonTeam,
} from "./lib/teamAdmin";
import {
  createSeasonRound,
  getCourseTees,
  getSeasonRounds,
  summarizeSeasonRounds,
  updateSeasonRound,
} from "./lib/roundAdmin";
import {
  getRoundParticipants,
  saveRoundParticipants,
  summarizeRoundParticipants,
} from "./lib/roundParticipants";
import {
  createFlight,
  deleteEmptyFlight,
  getFlightAdminData,
  getSeasonRoundsForFlights,
  saveFlightPlayers,
  summarizeFlightSetup,
  updateFlight,
} from "./lib/flightAdmin";

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
  const [mainTab, setMainTab] = useState(null);
  const [tab, setTab] = useState("season");
  const [menuOpen, setMenuOpen] = useState(false);
  const [standings, setStandings] = useState([]);
  const [liveData, setLiveData] = useState(null);
  const [teamData, setTeamData] = useState(null);
  const [closestEntries, setClosestEntries] = useState([]);
  const [approvedBonuses, setApprovedBonuses] = useState([]);
  const [finalStandingsData, setFinalStandingsData] = useState(null);
  const [hallOfFame, setHallOfFame] = useState([]);
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

      try {
        const currentHallOfFame = await getFormattedHallOfFame();
        setHallOfFame(currentHallOfFame);
      } catch (hallError) {
        console.error("Hall of Fame kunne ikke hentes:", hallError);
        setHallOfFame([]);
      }

      try {
        const currentFinalStandings = await getFinalStandings({
          season: 2026,
          roundSixNumber: 6,
          roundSevenNumber: 7,
        });
        setFinalStandingsData(currentFinalStandings);
      } catch (finalError) {
        console.error(
          "Finalestillingen kunne ikke hentes:",
          finalError
        );
        setFinalStandingsData(null);
      }
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

  useEffect(() => {
    if (!menuOpen) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  function openPublicView(nextMainTab, nextTab) {
    setMainTab(nextMainTab);
    setTab(nextTab);
    setMenuOpen(false);
  }

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
    final: {
      eyebrow: "Individuel finale",
      title: finalStandingsData?.finalCompleted
        ? "Endelig TGT-stilling"
        : "Foreløbig TGT-stilling",
      description:
        "Halveret grundspil plus officiel score fra Runde 6 og Runde 7. Godkendte bonusser indgår kun efter 18 huller i den relevante runde.",
    },
    hall: {
      eyebrow: "TGT historik",
      title: "Hall of Fame",
      description:
        "Permanente mestre fra afsluttede TGT-sæsoner.",
    },
  };

  const currentHeading = headings[tab];

  return (
    <div className="app tgt-public-shell">
      <style>{`
        .tgt-public-shell { background: #f3efe6; min-height: 100vh; }
        .tgt-public-topbar { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; justify-content: space-between; padding: 14px clamp(18px, 4vw, 54px); background: rgba(7, 43, 31, .96); color: #fff; backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,.12); }
        .tgt-wordmark { display: flex; align-items: center; gap: 12px; font-weight: 900; letter-spacing: .12em; }
        .tgt-wordmark-mark { display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid #d7b469; border-radius: 50%; color: #f0cf82; font-family: Georgia, serif; font-size: 17px; font-weight: 900; letter-spacing: .04em; text-shadow: 0 1px 14px rgba(215,180,105,.35); }
        .tgt-menu-button { min-width: 46px; min-height: 46px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.22); border-radius: 50%; background: transparent; color: #fff; cursor: pointer; font-size: 24px; }
        .tgt-premium-hero { position: relative; overflow: hidden; padding: clamp(54px, 9vw, 110px) clamp(20px, 7vw, 92px); color: #fff; background: radial-gradient(circle at 78% 20%, rgba(215,180,105,.24), transparent 28%), linear-gradient(135deg, #062f22 0%, #0b5239 58%, #123a2d 100%); }
        .tgt-premium-hero:after { content: ""; position: absolute; right: -80px; bottom: -170px; width: 480px; height: 480px; border: 1px solid rgba(255,255,255,.1); border-radius: 50%; box-shadow: 0 0 0 55px rgba(255,255,255,.035), 0 0 0 110px rgba(255,255,255,.025); }
        .tgt-hero-inner { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; }
        .tgt-kicker { display: inline-flex; align-items: center; gap: 9px; padding: 7px 11px; border: 1px solid rgba(215,180,105,.45); border-radius: 999px; color: #f0d99e; font-size: 12px; font-weight: 800; letter-spacing: .14em; }
        .tgt-premium-hero h1 { max-width: 780px; margin: 22px 0 12px; font-family: Georgia, serif; font-size: clamp(44px, 8vw, 92px); line-height: .95; letter-spacing: -.045em; }
        .tgt-premium-hero h1 span { display: block; color: #d7b469; font-size: .43em; letter-spacing: .08em; margin-top: 16px; text-transform: uppercase; }
        .tgt-hero-meta { display: flex; flex-wrap: wrap; gap: 10px 24px; margin-top: 26px; color: rgba(255,255,255,.78); font-weight: 650; }
        .tgt-hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
        .tgt-primary-action, .tgt-secondary-action { min-height: 48px; padding: 0 20px; border-radius: 999px; font-weight: 800; cursor: pointer; }
        .tgt-primary-action { border: 1px solid #d7b469; background: #d7b469; color: #082b20; }
        .tgt-secondary-action { border: 1px solid rgba(255,255,255,.28); background: rgba(255,255,255,.06); color: #fff; }
        .tgt-menu-backdrop { position: fixed; inset: 0; z-index: 45; background: rgba(2,20,14,.58); backdrop-filter: blur(3px); }
        .tgt-drawer { position: fixed; top: 0; right: 0; z-index: 50; width: min(390px, 92vw); height: 100dvh; padding: 22px; background: #f7f3ea; color: #10271e; box-shadow: -20px 0 60px rgba(0,0,0,.25); overflow-y: auto; }
        .tgt-drawer-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 18px; border-bottom: 1px solid #d9d3c8; }
        .tgt-drawer-close { min-width: 44px; min-height: 44px; border: 1px solid #d5cec2; border-radius: 50%; background: #fff; font-size: 22px; cursor: pointer; }
        .tgt-drawer-nav { display: grid; gap: 8px; margin-top: 20px; }
        .tgt-drawer-nav button { width: 100%; min-height: 52px; padding: 0 15px; text-align: left; border: 1px solid #dfd8cc; border-radius: 12px; background: #fff; color: #173326; font-weight: 750; cursor: pointer; }
        .tgt-public-shell .main-content { margin-top: -28px; position: relative; z-index: 3; }
        .tgt-public-shell .leaderboard-card { border-radius: 22px; overflow: hidden; box-shadow: 0 24px 70px rgba(20,45,34,.14); }
        @media (max-width: 700px) {
          .tgt-public-topbar { padding: 10px 14px; }
          .tgt-wordmark small { display: none; }
          .tgt-premium-hero { padding: 46px 18px 70px; }
          .tgt-premium-hero h1 { font-size: clamp(42px, 16vw, 64px); }
          .tgt-hero-meta { display: grid; gap: 8px; }
          .tgt-hero-actions > button { width: 100%; }
          .tgt-public-shell .main-content { margin-top: -22px; padding-left: 10px; padding-right: 10px; }
          .tgt-public-shell .leaderboard-card { border-radius: 16px; }
          .tgt-public-shell .tgt-tabs { overflow-x: auto; flex-wrap: nowrap; justify-content: flex-start; scrollbar-width: none; }
          .tgt-public-shell .tgt-tabs button { flex: 0 0 auto; min-height: 44px; white-space: nowrap; }
          .tgt-public-shell table { min-width: 680px; }
          .tgt-public-shell .table-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        }
      `}</style>

      <header className="tgt-public-topbar">
        <div className="tgt-wordmark">
          <span className="tgt-wordmark-mark">TGT</span>
          <span>
            THE GOLDEN TEE TOUR
            <small style={{ display: "block", opacity: .62, fontSize: 9, marginTop: 2 }}>
              EST. 2023
            </small>
          </span>
        </div>
        <button
          type="button"
          className="tgt-menu-button"
          aria-label="Åbn hovedmenu"
          aria-expanded={menuOpen}
          aria-controls="tgt-main-menu"
          onClick={() => setMenuOpen(true)}
        >
          ☰
        </button>
      </header>

      {menuOpen && (
        <>
          <div className="tgt-menu-backdrop" onClick={() => setMenuOpen(false)} />
          <aside id="tgt-main-menu" className="tgt-drawer" aria-label="Hovedmenu">
            <div className="tgt-drawer-header">
              <div>
                <p className="eyebrow">The Golden Tee Tour</p>
                <strong style={{ fontSize: 22 }}>Menu</strong>
              </div>
              <button
                type="button"
                className="tgt-drawer-close"
                aria-label="Luk hovedmenu"
                onClick={() => setMenuOpen(false)}
              >
                ×
              </button>
            </div>
            <nav className="tgt-drawer-nav">
              <button type="button" onClick={() => openPublicView("individual", "season")}>Individuelt overblik</button>
              <button type="button" onClick={() => openPublicView("individual", "live")}>Live leaderboard</button>
              <button type="button" onClick={() => openPublicView("team", "team")}>Holdturneringen</button>
              <button type="button" onClick={() => openPublicView("individual", "final")}>Finalestillingen</button>
              <button type="button" onClick={() => openPublicView("individual", "closest")}>Tættest på pinden</button>
              <button type="button" onClick={() => openPublicView("individual", "hall")}>Hall of Fame</button>
              <button type="button" onClick={() => { setMenuOpen(false); onOpenLogin(); }}>Markør- og admin-login</button>
            </nav>
          </aside>
        </>
      )}

      <section className="tgt-premium-hero">
        <div className="tgt-hero-inner">
          <span className="tgt-kicker">FINAL WEEKEND · TGT 2026</span>
          <h1>
            The Golden Tee Tour
            <span>Leaderboard</span>
          </h1>
          <div className="tgt-hero-meta">
            <span>11. til 12. september 2026</span>
            <span>Lübker Golf Resort</span>
            <span>15 spillere · 7 hold</span>
          </div>
          <div className="tgt-hero-actions">
            <button
              type="button"
              className="tgt-primary-action"
              onClick={() => openPublicView("individual", "live")}
            >
              Følg live
            </button>
            <button
              type="button"
              className="tgt-secondary-action"
              onClick={() => openPublicView("individual", "season")}
            >
              Se stillingen
            </button>
            <button
              type="button"
              className="tgt-secondary-action"
              onClick={onOpenLogin}
            >
              Markør-login
            </button>
          </div>
        </div>
      </section>

      <main className="main-content">
        <section className="leaderboard-card">
          <nav
            aria-label="Leaderboard kategori"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              padding: 10,
              background: "#eaf1ec",
              borderBottom: "1px solid #d8e4db",
            }}
          >
            <button
              type="button"
              onClick={() => {
                setMainTab("individual");
                setTab("season");
              }}
              className={
                mainTab === "individual"
                  ? "login-submit-button"
                  : "login-cancel-button"
              }
              style={{ marginTop: 0, fontSize: 17 }}
            >
              Individuel
            </button>
            <button
              type="button"
              onClick={() => {
                setMainTab("team");
                setTab("team");
              }}
              className={
                mainTab === "team"
                  ? "login-submit-button"
                  : "login-cancel-button"
              }
              style={{ marginTop: 0, fontSize: 17 }}
            >
              Hold
            </button>
          </nav>

          {!mainTab && (
            <div
              style={{
                padding: "18px 20px",
                textAlign: "center",
                color: "#617067",
                background: "#f8faf8",
                borderBottom: "1px solid #e2e9e4",
                fontWeight: 700,
              }}
            >
              Vælg Individuel eller Hold for at åbne turneringsoversigten
            </div>
          )}

          {mainTab && (
          <div
            className="tgt-tabs"
            style={{
              paddingTop: 12,
              paddingBottom: 12,
              background: "#f8faf8",
              borderBottom: "1px solid #e2e9e4",
            }}
          >
            {mainTab === "individual" ? (
              <>
                {[
                  ["season", "Overblik"],
                  ["live", "Runde 6 live"],
                  ["final", "Samlet finalestilling"],
                  ["closest", "Tættest på pinden"],
                  ["hall", "Hall of Fame"],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setTab(value)}
                    className={
                      tab === value
                        ? "login-submit-button"
                        : "login-cancel-button"
                    }
                    style={{ width: "auto", marginTop: 0 }}
                  >
                    {label}
                  </button>
                ))}
              </>
            ) : (
              <button
                type="button"
                onClick={() => setTab("team")}
                className="login-submit-button"
                style={{ width: "auto", marginTop: 0 }}
              >
                Overblik
              </button>
            )}
          </div>
          )}

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

          {!loading && !errorMessage && tab === "final" && (
            <div>
              {finalStandingsData ? (
                <>
                  {finalStandingsData.champion && (
                    <section
                      style={{
                        margin: 20,
                        padding: 22,
                        borderRadius: 18,
                        color: "#ffffff",
                        background:
                          "linear-gradient(135deg, #0b4935, #18704e)",
                      }}
                    >
                      <p
                        className="eyebrow"
                        style={{ color: "#dafaaf" }}
                      >
                        TGT-mester 2026
                      </p>
                      <h2 style={{ margin: "5px 0" }}>
                        {finalStandingsData.champion.playerName}
                      </h2>
                      <strong style={{ fontSize: 24 }}>
                        {formatScore(
                          finalStandingsData.champion.finalScore
                        )}
                      </strong>
                    </section>
                  )}

                  {!finalStandingsData.finalCompleted && (
                    <div className="status-box">
                      Foreløbig stilling. {finalStandingsData.completedPlayers} af 15
                      spillere har gennemført hele finaleforløbet.
                    </div>
                  )}

                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th className="position-column">Placering</th>
                          <th>Spiller</th>
                          <th className="number-column">Udgangspunkt</th>
                          <th className="number-column">Runde 6</th>
                          <th className="number-column">Runde 7</th>
                          <th className="number-column">Samlet</th>
                        </tr>
                      </thead>
                      <tbody>
                        {finalStandingsData.standings.map((player) => (
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
                              <small
                                style={{
                                  display: "block",
                                  color: "#78827d",
                                }}
                              >
                                Runde 6: {player.roundSixHoles}/18 · Runde 7:{" "}
                                {player.roundSevenHoles}/18
                              </small>
                            </td>
                            <td className="number-column">
                              {formatScore(player.startingScore)}
                            </td>
                            <td className="number-column">
                              {player.roundSixHoles === 0
                                ? "Ikke startet"
                                : formatScore(player.roundSixOfficialScore)}
                            </td>
                            <td className="number-column">
                              {player.roundSevenHoles === 0
                                ? "Ikke startet"
                                : formatScore(player.roundSevenOfficialScore)}
                            </td>
                            <td className="number-column final-score">
                              {player.finalCompleted
                                ? formatScore(player.finalScore)
                                : "Afventer"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="status-box">
                  Finalestillingen kunne ikke beregnes endnu. Kontrollér, at
                  Runde 6 og Runde 7 findes og har deltagere.
                </div>
              )}
            </div>
          )}

          {!loading && !errorMessage && tab === "hall" && (
            <div style={{ padding: 20 }}>
              {hallOfFame.length === 0 ? (
                <div className="status-box" style={{ margin: 0 }}>
                  Ingen afsluttede TGT-sæsoner endnu.
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(280px, 1fr))",
                    gap: 16,
                  }}
                >
                  {hallOfFame.map((entry) => (
                    <article
                      key={entry.id}
                      style={{
                        overflow: "hidden",
                        border: "1px solid #d8e4db",
                        borderRadius: 18,
                        background: "#ffffff",
                      }}
                    >
                      <header
                        style={{
                          padding: 18,
                          color: "#ffffff",
                          background:
                            "linear-gradient(135deg, #0b4935, #18704e)",
                        }}
                      >
                        <p
                          className="eyebrow"
                          style={{ color: "#dafaaf" }}
                        >
                          TGT sæson
                        </p>
                        <h2 style={{ margin: "4px 0 0" }}>
                          {entry.season}
                        </h2>
                      </header>

                      <div style={{ padding: 18 }}>
                        <section>
                          <p className="eyebrow">Individuel mester</p>
                          <h3 style={{ margin: "5px 0" }}>
                            {entry.individualChampionName}
                          </h3>
                        </section>

                        {entry.teamChampionName && (
                          <section
                            style={{
                              marginTop: 20,
                              paddingTop: 18,
                              borderTop: "1px solid #e5ebe6",
                            }}
                          >
                            <p className="eyebrow">Holdmester</p>
                            <h3 style={{ margin: "5px 0" }}>
                              {entry.teamChampionName}
                            </h3>
                          </section>
                        )}

                        <section
                          style={{
                            marginTop: 20,
                            paddingTop: 18,
                            borderTop: "1px solid #e5ebe6",
                          }}
                        >
                          <p className="eyebrow">Finalebane</p>
                          <h3 style={{ margin: "5px 0" }}>
                            {entry.finalCourse ?? "Ikke registreret"}
                          </h3>
                        </section>
                      </div>
                    </article>
                  ))}
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

function SeasonPlayersAdmin({ season = 2027 }) {
  const [players, setPlayers] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingPlayerId, setSavingPlayerId] = useState(null);
  const [creatingPlayer, setCreatingPlayer] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [newPlayer, setNewPlayer] = useState({
    name: "",
    email: "",
    handicapIndex: "",
    teamCompetition: true,
  });

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const result = await getSeasonPlayers(season);
      setPlayers(result.players);

      const nextDrafts = {};
      result.players.forEach((player) => {
        nextDrafts[player.id] = {
          name: player.name ?? "",
          email: player.email ?? "",
          handicapIndex: player.handicap_index ?? "",
          genderCode: player.gender_code ?? "",
          active: player.active,
          teamCompetition: player.team_competition,
        };
      });
      setDrafts(nextDrafts);
    } catch (error) {
      console.error("Fejl ved hentning af sæsonspillere:", error);
      setErrorMessage(
        error.message ?? "Spillerne kunne ikke hentes."
      );
    } finally {
      setLoading(false);
    }
  }, [season]);

  useEffect(() => {
    loadPlayers();
  }, [loadPlayers]);

  const summary = summarizeSeasonPlayers(players);

  function updateDraft(playerId, field, value) {
    setDrafts((current) => ({
      ...current,
      [playerId]: {
        ...current[playerId],
        [field]: value,
      },
    }));
    setMessage("");
    setErrorMessage("");
  }

  async function handleSavePlayer(playerId) {
    const draft = drafts[playerId];
    if (!draft) return;

    setSavingPlayerId(playerId);
    setMessage("");
    setErrorMessage("");

    try {
      const savedPlayer = await updateSeasonPlayer({
        playerId,
        name: draft.name,
        email: draft.email,
        handicapIndex: draft.handicapIndex,
        active: draft.active,
        teamCompetition: draft.teamCompetition,
        genderCode: draft.genderCode,
      });
      setMessage(`${savedPlayer.name} er gemt.`);
      await loadPlayers();
    } catch (error) {
      console.error("Fejl ved gemning af spiller:", error);
      setErrorMessage(
        error.message ?? "Spilleren kunne ikke gemmes."
      );
    } finally {
      setSavingPlayerId(null);
    }
  }

  async function handleCreatePlayer(event) {
    event.preventDefault();
    setCreatingPlayer(true);
    setMessage("");
    setErrorMessage("");

    try {
      const createdPlayer = await createSeasonPlayer({
        season,
        name: newPlayer.name,
        email: newPlayer.email,
        handicapIndex: newPlayer.handicapIndex,
        teamCompetition: newPlayer.teamCompetition,
      });
      setNewPlayer({
        name: "",
        email: "",
        handicapIndex: "",
        teamCompetition: true,
      });
      setMessage(`${createdPlayer.name} er oprettet i TGT ${season}.`);
      await loadPlayers();
    } catch (error) {
      console.error("Fejl ved oprettelse af spiller:", error);
      setErrorMessage(
        error.message ?? "Spilleren kunne ikke oprettes."
      );
    } finally {
      setCreatingPlayer(false);
    }
  }

  return (
    <section
      style={{
        marginTop: 24,
        padding: 20,
        border: "1px solid #d8e4db",
        borderRadius: 16,
        background: "#ffffff",
      }}
    >
      <p className="eyebrow">TGT {season}</p>
      <h2 style={{ marginTop: 0 }}>Spilleradministration</h2>

      {loading && (
        <div className="status-box">Henter spillere...</div>
      )}

      {!loading && (
        <>
          <div className="flight-information" style={{ marginTop: 18 }}>
            <div><span>Alle</span><strong>{summary.totalPlayers}</strong></div>
            <div><span>Aktive</span><strong>{summary.activePlayers}</strong></div>
            <div><span>Holdspillere</span><strong>{summary.teamPlayers}</strong></div>
            <div><span>Kun individuel</span><strong>{summary.individualOnlyPlayers}</strong></div>
            <div><span>Inaktive</span><strong>{summary.inactivePlayers}</strong></div>
            <div><span>Mangler handicap</span><strong>{summary.missingHandicap}</strong></div>
          </div>

          {errorMessage && (
            <div className="error-box" style={{ margin: "18px 0 0" }}>
              {errorMessage}
            </div>
          )}

          {message && (
            <div
              style={{
                marginTop: 18,
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

          <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
            {players.map((player) => {
              const draft = drafts[player.id];
              if (!draft) return null;

              return (
                <article
                  key={player.id}
                  style={{
                    padding: 16,
                    border: "1px solid #e1e8e3",
                    borderRadius: 14,
                    background: draft.active ? "#fafbf9" : "#f4f4f4",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(180px, 1.3fr) minmax(180px, 1.3fr) minmax(110px, .6fr)",
                      gap: 10,
                    }}
                  >
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        updateDraft(player.id, "name", event.target.value)
                      }
                      className="form-input"
                      placeholder="Navn"
                    />
                    <input
                      type="email"
                      value={draft.email}
                      onChange={(event) =>
                        updateDraft(player.id, "email", event.target.value)
                      }
                      className="form-input"
                      placeholder="E-mail"
                    />
                    <input
                      type="number"
                      step="0.1"
                      min="-10"
                      max="54"
                      value={draft.handicapIndex}
                      onChange={(event) =>
                        updateDraft(
                          player.id,
                          "handicapIndex",
                          event.target.value
                        )
                      }
                      className="form-input"
                      placeholder="HCP"
                    />
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 18,
                      marginTop: 12,
                    }}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.active}
                        onChange={(event) =>
                          updateDraft(player.id, "active", event.target.checked)
                        }
                      />{" "}
                      Aktiv
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.teamCompetition}
                        onChange={(event) =>
                          updateDraft(
                            player.id,
                            "teamCompetition",
                            event.target.checked
                          )
                        }
                      />{" "}
                      Holdturnering
                    </label>
                    <button
                      type="button"
                      onClick={() => handleSavePlayer(player.id)}
                      disabled={savingPlayerId === player.id}
                      className="login-submit-button"
                      style={{ width: "auto", margin: "0 0 0 auto" }}
                    >
                      {savingPlayerId === player.id ? "Gemmer..." : "Gem spiller"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <form
            onSubmit={handleCreatePlayer}
            style={{
              marginTop: 26,
              paddingTop: 22,
              borderTop: "1px solid #e1e8e3",
            }}
          >
            <p className="eyebrow">Ny deltager</p>
            <h3 style={{ margin: "5px 0 14px" }}>Tilføj spiller</h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(180px, 1.3fr) minmax(180px, 1.3fr) minmax(110px, .6fr)",
                gap: 10,
              }}
            >
              <input
                value={newPlayer.name}
                onChange={(event) =>
                  setNewPlayer((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="form-input"
                placeholder="Fulde navn"
                required
              />
              <input
                type="email"
                value={newPlayer.email}
                onChange={(event) =>
                  setNewPlayer((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                className="form-input"
                placeholder="E-mail, valgfri"
              />
              <input
                type="number"
                step="0.1"
                min="-10"
                max="54"
                value={newPlayer.handicapIndex}
                onChange={(event) =>
                  setNewPlayer((current) => ({
                    ...current,
                    handicapIndex: event.target.value,
                  }))
                }
                className="form-input"
                placeholder="HCP"
              />
            </div>
            <label style={{ display: "block", marginTop: 12 }}>
              <input
                type="checkbox"
                checked={newPlayer.teamCompetition}
                onChange={(event) =>
                  setNewPlayer((current) => ({
                    ...current,
                    teamCompetition: event.target.checked,
                  }))
                }
              />{" "}
              Deltager i holdturneringen
            </label>
            <button
              type="submit"
              disabled={creatingPlayer}
              className="login-submit-button"
              style={{ maxWidth: 300 }}
            >
              {creatingPlayer ? "Opretter..." : "Opret spiller"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function SeasonTeamsAdmin({ season = 2027 }) {
  const [teams, setTeams] = useState([]);
  const [eligiblePlayers, setEligiblePlayers] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [newTeam, setNewTeam] = useState({
    name: "",
    playerOneId: "",
    playerTwoId: "",
  });
  const [loading, setLoading] = useState(true);
  const [savingTeamId, setSavingTeamId] = useState(null);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const result = await getSeasonTeams(season);
      setTeams(result.teams);
      setEligiblePlayers(result.eligiblePlayers);

      const nextDrafts = {};
      result.teams.forEach((team) => {
        nextDrafts[team.id] = {
          name: team.name,
          playerOneId: team.members[0]?.playerId ?? "",
          playerTwoId: team.members[1]?.playerId ?? "",
        };
      });
      setDrafts(nextDrafts);
    } catch (error) {
      console.error("Fejl ved hentning af hold:", error);
      setErrorMessage(error.message ?? "Holdene kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }, [season]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  const summary = summarizeSeasonTeams({ teams, eligiblePlayers });

  function updateDraft(teamId, field, value) {
    setDrafts((current) => ({
      ...current,
      [teamId]: {
        ...current[teamId],
        [field]: value,
      },
    }));
    setMessage("");
    setErrorMessage("");
  }

  function playerOptionsForTeam(teamId) {
    const currentMemberIds = new Set(
      teams
        .find((team) => team.id === teamId)
        ?.members.map((member) => member.playerId) ?? []
    );

    const assignedElsewhere = new Set(
      teams
        .filter((team) => team.active && team.id !== teamId)
        .flatMap((team) => team.members.map((member) => member.playerId))
    );

    return eligiblePlayers.filter(
      (player) =>
        currentMemberIds.has(player.id) || !assignedElsewhere.has(player.id)
    );
  }

  const assignedActivePlayerIds = new Set(
    teams
      .filter((team) => team.active)
      .flatMap((team) => team.members.map((member) => member.playerId))
  );

  const availableForNewTeam = eligiblePlayers.filter(
    (player) => !assignedActivePlayerIds.has(player.id)
  );

  async function handleSaveTeam(teamId) {
    const draft = drafts[teamId];
    if (!draft) return;

    setSavingTeamId(teamId);
    setMessage("");
    setErrorMessage("");

    try {
      const saved = await updateSeasonTeam({
        teamId,
        name: draft.name,
        playerIds: [draft.playerOneId, draft.playerTwoId],
      });
      setMessage(`${saved.name} er gemt.`);
      await loadTeams();
    } catch (error) {
      console.error("Fejl ved gemning af hold:", error);
      setErrorMessage(error.message ?? "Holdet kunne ikke gemmes.");
    } finally {
      setSavingTeamId(null);
    }
  }

  async function handleDeactivateTeam(team) {
    const confirmed = window.confirm(
      `Vil du deaktivere ${team.name} og frigive spillerne?`
    );
    if (!confirmed) return;

    setSavingTeamId(team.id);
    setMessage("");
    setErrorMessage("");

    try {
      await deactivateAndReleaseTeam(team.id);
      setMessage(`${team.name} er deaktiveret, og spillerne er frigivet.`);
      await loadTeams();
    } catch (error) {
      console.error("Fejl ved deaktivering af hold:", error);
      setErrorMessage(error.message ?? "Holdet kunne ikke deaktiveres.");
    } finally {
      setSavingTeamId(null);
    }
  }

  async function handleCreateTeam(event) {
    event.preventDefault();
    setCreatingTeam(true);
    setMessage("");
    setErrorMessage("");

    try {
      const created = await createSeasonTeam({
        season,
        name: newTeam.name,
        playerIds: [newTeam.playerOneId, newTeam.playerTwoId],
      });
      setNewTeam({ name: "", playerOneId: "", playerTwoId: "" });
      setMessage(`${created.name} er oprettet.`);
      await loadTeams();
    } catch (error) {
      console.error("Fejl ved oprettelse af hold:", error);
      setErrorMessage(error.message ?? "Holdet kunne ikke oprettes.");
    } finally {
      setCreatingTeam(false);
    }
  }

  return (
    <section
      style={{
        marginTop: 24,
        padding: 20,
        border: "1px solid #d8e4db",
        borderRadius: 16,
        background: "#ffffff",
      }}
    >
      <p className="eyebrow">TGT {season}</p>
      <h2 style={{ marginTop: 0 }}>Holdadministration</h2>

      {loading && <div className="status-box">Henter hold...</div>}

      {!loading && (
        <>
          <div className="flight-information" style={{ marginTop: 18 }}>
            <div><span>Alle hold</span><strong>{summary.totalTeams}</strong></div>
            <div><span>Aktive hold</span><strong>{summary.activeTeams}</strong></div>
            <div><span>Fordelte spillere</span><strong>{summary.assignedPlayers}</strong></div>
            <div><span>Ledige holdspillere</span><strong>{summary.availablePlayers}</strong></div>
            <div><span>Inaktive hold</span><strong>{summary.inactiveTeams}</strong></div>
            <div><span>Ugyldige hold</span><strong>{summary.invalidActiveTeams}</strong></div>
          </div>

          {errorMessage && (
            <div className="error-box" style={{ margin: "18px 0 0" }}>
              {errorMessage}
            </div>
          )}

          {message && (
            <div
              style={{
                marginTop: 18,
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

          <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
            {teams.map((team) => {
              const draft = drafts[team.id];
              if (!draft) return null;
              const options = playerOptionsForTeam(team.id);

              return (
                <article
                  key={team.id}
                  style={{
                    padding: 16,
                    border: "1px solid #e1e8e3",
                    borderRadius: 14,
                    background: team.active ? "#fafbf9" : "#f4f4f4",
                  }}
                >
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      updateDraft(team.id, "name", event.target.value)
                    }
                    className="form-input"
                    placeholder="Holdnavn"
                    disabled={!team.active}
                  />

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 10,
                      marginTop: 10,
                    }}
                  >
                    {[
                      ["playerOneId", "Spiller 1"],
                      ["playerTwoId", "Spiller 2"],
                    ].map(([field, label]) => (
                      <select
                        key={field}
                        value={draft[field]}
                        onChange={(event) =>
                          updateDraft(team.id, field, event.target.value)
                        }
                        className="form-input"
                        disabled={!team.active}
                      >
                        <option value="">{label}</option>
                        {options.map((player) => (
                          <option
                            key={player.id}
                            value={player.id}
                            disabled={
                              field === "playerOneId"
                                ? player.id === draft.playerTwoId
                                : player.id === draft.playerOneId
                            }
                          >
                            {player.name}
                          </option>
                        ))}
                      </select>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      flexWrap: "wrap",
                      gap: 10,
                      marginTop: 12,
                    }}
                  >
                    {team.active ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDeactivateTeam(team)}
                          disabled={savingTeamId === team.id}
                          className="login-cancel-button"
                          style={{ width: "auto", marginTop: 0 }}
                        >
                          Deaktivér og frigiv
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveTeam(team.id)}
                          disabled={savingTeamId === team.id}
                          className="login-submit-button"
                          style={{ width: "auto", marginTop: 0 }}
                        >
                          {savingTeamId === team.id ? "Gemmer..." : "Gem hold"}
                        </button>
                      </>
                    ) : (
                      <strong style={{ color: "#78827d" }}>Inaktivt hold</strong>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <form
            onSubmit={handleCreateTeam}
            style={{
              marginTop: 26,
              paddingTop: 22,
              borderTop: "1px solid #e1e8e3",
            }}
          >
            <p className="eyebrow">Nyt makkerpar</p>
            <h3 style={{ margin: "5px 0 14px" }}>Opret hold</h3>

            <input
              value={newTeam.name}
              onChange={(event) =>
                setNewTeam((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              className="form-input"
              placeholder="Holdnavn"
              required
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginTop: 10,
              }}
            >
              <select
                value={newTeam.playerOneId}
                onChange={(event) =>
                  setNewTeam((current) => ({
                    ...current,
                    playerOneId: event.target.value,
                  }))
                }
                className="form-input"
                required
              >
                <option value="">Vælg spiller 1</option>
                {availableForNewTeam.map((player) => (
                  <option
                    key={player.id}
                    value={player.id}
                    disabled={player.id === newTeam.playerTwoId}
                  >
                    {player.name}
                  </option>
                ))}
              </select>

              <select
                value={newTeam.playerTwoId}
                onChange={(event) =>
                  setNewTeam((current) => ({
                    ...current,
                    playerTwoId: event.target.value,
                  }))
                }
                className="form-input"
                required
              >
                <option value="">Vælg spiller 2</option>
                {availableForNewTeam.map((player) => (
                  <option
                    key={player.id}
                    value={player.id}
                    disabled={player.id === newTeam.playerOneId}
                  >
                    {player.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={
                creatingTeam ||
                !newTeam.name.trim() ||
                !newTeam.playerOneId ||
                !newTeam.playerTwoId
              }
              className="login-submit-button"
              style={{ maxWidth: 300 }}
            >
              {creatingTeam ? "Opretter..." : "Opret hold"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function SeasonRoundsAdmin({ season = 2027 }) {
  const emptyRound = {
    roundNumber: "",
    name: "",
    playedAt: "",
    courseId: "",
    teeId: "",
    roundType: "regular",
    individualEnabled: true,
    teamEnabled: true,
    closestToPinEnabled: true,
  };

  const [rounds, setRounds] = useState([]);
  const [courses, setCourses] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [teesByCourse, setTeesByCourse] = useState({});
  const [newRound, setNewRound] = useState(emptyRound);
  const [newRoundTees, setNewRoundTees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingRoundId, setSavingRoundId] = useState(null);
  const [creatingRound, setCreatingRound] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadRounds = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const result = await getSeasonRounds(season);
      setRounds(result.rounds);
      setCourses(result.courses);

      const nextDrafts = {};
      const courseIds = [
        ...new Set(result.rounds.map((round) => round.course_id).filter(Boolean)),
      ];
      const teeEntries = await Promise.all(
        courseIds.map(async (courseId) => [
          courseId,
          await getCourseTees(courseId),
        ])
      );
      const nextTeesByCourse = Object.fromEntries(teeEntries);
      setTeesByCourse(nextTeesByCourse);

      result.rounds.forEach((round) => {
        nextDrafts[round.id] = {
          roundNumber: round.round_number,
          name: round.name,
          playedAt: round.played_at ?? "",
          courseId: round.course_id ?? "",
          teeId: round.tee_id ?? "",
          roundType: round.round_type ?? "regular",
          individualEnabled: round.individual_enabled,
          teamEnabled: round.team_enabled,
          closestToPinEnabled: round.closest_to_pin_enabled,
        };
      });
      setDrafts(nextDrafts);
    } catch (error) {
      console.error("Fejl ved hentning af 2027-runder:", error);
      setErrorMessage(error.message ?? "Runderne kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }, [season]);

  useEffect(() => {
    loadRounds();
  }, [loadRounds]);

  const summary = summarizeSeasonRounds(rounds);

  async function ensureTees(courseId) {
    if (!courseId || teesByCourse[courseId]) return;
    const tees = await getCourseTees(courseId);
    setTeesByCourse((current) => ({ ...current, [courseId]: tees }));
  }

  function updateDraft(roundId, field, value) {
    setDrafts((current) => ({
      ...current,
      [roundId]: { ...current[roundId], [field]: value },
    }));
    setMessage("");
    setErrorMessage("");
  }

  async function handleDraftCourseChange(roundId, courseId) {
    updateDraft(roundId, "courseId", courseId);
    updateDraft(roundId, "teeId", "");
    try {
      await ensureTees(courseId);
    } catch (error) {
      setErrorMessage(error.message ?? "Teestederne kunne ikke hentes.");
    }
  }

  async function handleNewCourseChange(courseId) {
    setNewRound((current) => ({ ...current, courseId, teeId: "" }));
    setNewRoundTees([]);
    if (!courseId) return;
    try {
      setNewRoundTees(await getCourseTees(courseId));
    } catch (error) {
      setErrorMessage(error.message ?? "Teestederne kunne ikke hentes.");
    }
  }

  async function handleSaveRound(roundId) {
    const draft = drafts[roundId];
    if (!draft) return;

    setSavingRoundId(roundId);
    setMessage("");
    setErrorMessage("");

    try {
      const saved = await updateSeasonRound({
        roundId,
        roundNumber: draft.roundNumber,
        name: draft.name,
        playedAt: draft.playedAt,
        courseId: draft.courseId,
        teeId: draft.teeId,
        roundType: draft.roundType,
        individualEnabled: draft.individualEnabled,
        teamEnabled: draft.teamEnabled,
        closestToPinEnabled: draft.closestToPinEnabled,
      });
      setMessage(`Runde ${saved.round_number} er gemt.`);
      await loadRounds();
    } catch (error) {
      console.error("Fejl ved gemning af runde:", error);
      setErrorMessage(error.message ?? "Runden kunne ikke gemmes.");
    } finally {
      setSavingRoundId(null);
    }
  }

  async function handleCreateRound(event) {
    event.preventDefault();
    setCreatingRound(true);
    setMessage("");
    setErrorMessage("");

    try {
      const created = await createSeasonRound({
        season,
        roundNumber: newRound.roundNumber,
        name: newRound.name,
        playedAt: newRound.playedAt,
        courseId: newRound.courseId,
        teeId: newRound.teeId,
        roundType: newRound.roundType,
        individualEnabled: newRound.individualEnabled,
        teamEnabled: newRound.teamEnabled,
        closestToPinEnabled: newRound.closestToPinEnabled,
      });
      setNewRound(emptyRound);
      setNewRoundTees([]);
      setMessage(`Runde ${created.round_number} er oprettet.`);
      await loadRounds();
    } catch (error) {
      console.error("Fejl ved oprettelse af runde:", error);
      setErrorMessage(error.message ?? "Runden kunne ikke oprettes.");
    } finally {
      setCreatingRound(false);
    }
  }

  function RoundSwitches({ value, onChange, disabled = false }) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
        {[
          ["individualEnabled", "Individuel"],
          ["teamEnabled", "Holdturnering"],
          ["closestToPinEnabled", "Tættest på pinden"],
        ].map(([field, label]) => (
          <label key={field}>
            <input
              type="checkbox"
              checked={Boolean(value[field])}
              onChange={(event) => onChange(field, event.target.checked)}
              disabled={disabled}
            />{" "}
            {label}
          </label>
        ))}
      </div>
    );
  }

  return (
    <section
      style={{
        marginTop: 24,
        padding: 20,
        border: "1px solid #d8e4db",
        borderRadius: 16,
        background: "#ffffff",
      }}
    >
      <p className="eyebrow">TGT {season}</p>
      <h2 style={{ marginTop: 0 }}>Rundeadministration</h2>

      {loading && <div className="status-box">Henter runder og baner...</div>}

      {!loading && (
        <>
          <div className="flight-information" style={{ marginTop: 18 }}>
            <div><span>Runder</span><strong>{summary.totalRounds}</strong></div>
            <div><span>Kladder</span><strong>{summary.draftRounds}</strong></div>
            <div><span>Individuelle</span><strong>{summary.individualRounds}</strong></div>
            <div><span>Holdrunder</span><strong>{summary.teamRounds}</strong></div>
            <div><span>Tættest på pinden</span><strong>{summary.closestToPinRounds}</strong></div>
            <div><span>Mangler opsætning</span><strong>{summary.roundsWithoutCourse + summary.roundsWithoutTee}</strong></div>
          </div>

          {errorMessage && (
            <div className="error-box" style={{ margin: "18px 0 0" }}>
              {errorMessage}
            </div>
          )}

          {message && (
            <div
              style={{
                marginTop: 18,
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

          <div style={{ display: "grid", gap: 14, marginTop: 20 }}>
            {rounds.map((round) => {
              const draft = drafts[round.id];
              if (!draft) return null;
              const isLocked = Boolean(round.locked_at);
              const tees = teesByCourse[draft.courseId] ?? [];

              return (
                <article
                  key={round.id}
                  style={{
                    padding: 16,
                    border: "1px solid #e1e8e3",
                    borderRadius: 14,
                    background: isLocked ? "#eef7f0" : "#fafbf9",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "110px minmax(220px, 1.5fr) 170px",
                      gap: 10,
                    }}
                  >
                    <input
                      type="number"
                      min="1"
                      value={draft.roundNumber}
                      onChange={(event) =>
                        updateDraft(round.id, "roundNumber", event.target.value)
                      }
                      className="form-input"
                      placeholder="Nr."
                      disabled={isLocked}
                    />
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        updateDraft(round.id, "name", event.target.value)
                      }
                      className="form-input"
                      placeholder="Rundenavn"
                      disabled={isLocked}
                    />
                    <input
                      type="date"
                      value={draft.playedAt}
                      onChange={(event) =>
                        updateDraft(round.id, "playedAt", event.target.value)
                      }
                      className="form-input"
                      disabled={isLocked}
                    />
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.2fr 1fr 1fr",
                      gap: 10,
                      marginTop: 10,
                    }}
                  >
                    <select
                      value={draft.courseId}
                      onChange={(event) =>
                        handleDraftCourseChange(round.id, event.target.value)
                      }
                      className="form-input"
                      disabled={isLocked}
                    >
                      <option value="">Vælg bane</option>
                      {courses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.club_name} · {course.course_name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={draft.teeId}
                      onChange={(event) =>
                        updateDraft(round.id, "teeId", event.target.value)
                      }
                      className="form-input"
                      disabled={isLocked || !draft.courseId}
                    >
                      <option value="">Vælg tee</option>
                      {tees.map((tee) => (
                        <option key={tee.id} value={tee.id}>
                          {tee.tee_name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={draft.roundType}
                      onChange={(event) =>
                        updateDraft(round.id, "roundType", event.target.value)
                      }
                      className="form-input"
                      disabled={isLocked}
                    >
                      <option value="regular">Grundspil</option>
                      <option value="team_final">Holdfinale</option>
                      <option value="individual_final">Individuel finale</option>
                    </select>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 14,
                      marginTop: 14,
                    }}
                  >
                    <RoundSwitches
                      value={draft}
                      disabled={isLocked}
                      onChange={(field, value) =>
                        updateDraft(round.id, field, value)
                      }
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveRound(round.id)}
                      disabled={isLocked || savingRoundId === round.id}
                      className="login-submit-button"
                      style={{ width: "auto", marginTop: 0 }}
                    >
                      {isLocked
                        ? "Runden er låst"
                        : savingRoundId === round.id
                          ? "Gemmer..."
                          : "Gem runde"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <form
            onSubmit={handleCreateRound}
            style={{
              marginTop: 26,
              paddingTop: 22,
              borderTop: "1px solid #e1e8e3",
            }}
          >
            <p className="eyebrow">Ny spilledag</p>
            <h3 style={{ margin: "5px 0 14px" }}>Opret runde</h3>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "110px minmax(220px, 1.5fr) 170px",
                gap: 10,
              }}
            >
              <input
                type="number"
                min="1"
                value={newRound.roundNumber}
                onChange={(event) =>
                  setNewRound((current) => ({
                    ...current,
                    roundNumber: event.target.value,
                  }))
                }
                className="form-input"
                placeholder="Nr."
                required
              />
              <input
                value={newRound.name}
                onChange={(event) =>
                  setNewRound((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="form-input"
                placeholder="Rundenavn"
                required
              />
              <input
                type="date"
                value={newRound.playedAt}
                onChange={(event) =>
                  setNewRound((current) => ({
                    ...current,
                    playedAt: event.target.value,
                  }))
                }
                className="form-input"
                required
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 1fr",
                gap: 10,
                marginTop: 10,
              }}
            >
              <select
                value={newRound.courseId}
                onChange={(event) => handleNewCourseChange(event.target.value)}
                className="form-input"
                required
              >
                <option value="">Vælg bane</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.club_name} · {course.course_name}
                  </option>
                ))}
              </select>
              <select
                value={newRound.teeId}
                onChange={(event) =>
                  setNewRound((current) => ({
                    ...current,
                    teeId: event.target.value,
                  }))
                }
                className="form-input"
                disabled={!newRound.courseId}
                required
              >
                <option value="">Vælg tee</option>
                {newRoundTees.map((tee) => (
                  <option key={tee.id} value={tee.id}>
                    {tee.tee_name}
                  </option>
                ))}
              </select>
              <select
                value={newRound.roundType}
                onChange={(event) =>
                  setNewRound((current) => ({
                    ...current,
                    roundType: event.target.value,
                  }))
                }
                className="form-input"
              >
                <option value="regular">Grundspil</option>
                <option value="team_final">Holdfinale</option>
                <option value="individual_final">Individuel finale</option>
              </select>
            </div>

            <div style={{ marginTop: 14 }}>
              <RoundSwitches
                value={newRound}
                onChange={(field, value) =>
                  setNewRound((current) => ({
                    ...current,
                    [field]: value,
                  }))
                }
              />
            </div>

            <button
              type="submit"
              disabled={creatingRound}
              className="login-submit-button"
              style={{ maxWidth: 300 }}
            >
              {creatingRound ? "Opretter..." : "Opret runde"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function RoundParticipantsAdmin({ season = 2027 }) {
  const [rounds, setRounds] = useState([]);
  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [selectedRound, setSelectedRound] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [loadingRounds, setLoadingRounds] = useState(true);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadRounds = useCallback(async () => {
    setLoadingRounds(true);
    setErrorMessage("");

    try {
      const result = await getSeasonRounds(season);
      setRounds(result.rounds);

      if (
        selectedRoundId &&
        !result.rounds.some((round) => round.id === selectedRoundId)
      ) {
        setSelectedRoundId("");
        setSelectedRound(null);
        setParticipants([]);
      }
    } catch (error) {
      console.error("Fejl ved hentning af runder til deltagere:", error);
      setErrorMessage(error.message ?? "Runderne kunne ikke hentes.");
    } finally {
      setLoadingRounds(false);
    }
  }, [season, selectedRoundId]);

  useEffect(() => {
    loadRounds();
  }, [loadRounds]);

  async function handleSelectRound(roundId) {
    setSelectedRoundId(roundId);
    setSelectedRound(null);
    setParticipants([]);
    setMessage("");
    setErrorMessage("");

    if (!roundId) return;

    setLoadingParticipants(true);

    try {
      const result = await getRoundParticipants({
        season,
        roundId,
      });

      setSelectedRound(result.round);
      setParticipants(result.participants);
    } catch (error) {
      console.error("Fejl ved hentning af rundedeltagere:", error);
      setErrorMessage(error.message ?? "Deltagerne kunne ikke hentes.");
    } finally {
      setLoadingParticipants(false);
    }
  }

  function setParticipantRegistered(playerId, registered) {
    setParticipants((current) =>
      current.map((participant) =>
        participant.playerId === playerId
          ? {
              ...participant,
              isRegistered: registered,
              status: registered ? "registered" : "withdrawn",
            }
          : participant
      )
    );
    setMessage("");
    setErrorMessage("");
  }

  function setAllParticipants(registered) {
    setParticipants((current) =>
      current.map((participant) => ({
        ...participant,
        isRegistered: registered,
        status: registered ? "registered" : "withdrawn",
      }))
    );
    setMessage("");
    setErrorMessage("");
  }

  async function handleSaveParticipants() {
    if (!selectedRoundId) return;

    setSaving(true);
    setMessage("");
    setErrorMessage("");

    try {
      await saveRoundParticipants({
        roundId: selectedRoundId,
        participants: participants.map((participant) => ({
          playerId: participant.playerId,
          registered: participant.isRegistered,
        })),
      });

      setMessage(
        `Deltagerlisten for Runde ${selectedRound.round_number} er gemt.`
      );
      await handleSelectRound(selectedRoundId);
    } catch (error) {
      console.error("Fejl ved gemning af rundedeltagere:", error);
      setErrorMessage(error.message ?? "Deltagerlisten kunne ikke gemmes.");
    } finally {
      setSaving(false);
    }
  }

  const summary = summarizeRoundParticipants(participants);
  const isLocked = Boolean(selectedRound?.locked_at);

  return (
    <section
      style={{
        marginTop: 24,
        padding: 20,
        border: "1px solid #d8e4db",
        borderRadius: 16,
        background: "#ffffff",
      }}
    >
      <p className="eyebrow">TGT {season}</p>
      <h2 style={{ marginTop: 0 }}>Deltagere pr. runde</h2>
      <p className="description">
        Vælg en runde og markér, hvem der deltager. Frameldte spillere
        forbliver aktive i sæsonen, men kan ikke placeres i en bold på runden.
      </p>

      {loadingRounds ? (
        <div className="status-box">Henter runder...</div>
      ) : rounds.length === 0 ? (
        <div className="status-box">
          Opret mindst én 2027-runde, før deltagerlisten kan administreres.
        </div>
      ) : (
        <select
          value={selectedRoundId}
          onChange={(event) => handleSelectRound(event.target.value)}
          className="form-input"
          style={{ maxWidth: 520 }}
        >
          <option value="">Vælg runde</option>
          {rounds.map((round) => (
            <option key={round.id} value={round.id}>
              Runde {round.round_number} · {round.name} · {round.played_at ?? "Dato mangler"}
            </option>
          ))}
        </select>
      )}

      {loadingParticipants && (
        <div className="status-box">Henter deltagere...</div>
      )}

      {errorMessage && (
        <div className="error-box" style={{ margin: "18px 0 0" }}>
          {errorMessage}
        </div>
      )}

      {message && (
        <div
          style={{
            marginTop: 18,
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

      {!loadingParticipants && selectedRound && (
        <>
          <div className="flight-information" style={{ marginTop: 18 }}>
            <div><span>Aktive spillere</span><strong>{summary.totalPlayers}</strong></div>
            <div><span>Tilmeldt</span><strong>{summary.registeredPlayers}</strong></div>
            <div><span>Frameldt</span><strong>{summary.withdrawnPlayers}</strong></div>
            <div><span>Mangler handicap</span><strong>{summary.missingHandicap}</strong></div>
          </div>

          {isLocked && (
            <div className="error-box" style={{ margin: "18px 0 0" }}>
              <strong>Runden er låst</strong>
              <span>Deltagerlisten kan ikke ændres, før runden genåbnes.</span>
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              marginTop: 18,
            }}
          >
            <button
              type="button"
              onClick={() => setAllParticipants(true)}
              disabled={isLocked}
              className="login-cancel-button"
              style={{ width: "auto", marginTop: 0 }}
            >
              Tilmeld alle
            </button>
            <button
              type="button"
              onClick={() => setAllParticipants(false)}
              disabled={isLocked}
              className="login-cancel-button"
              style={{ width: "auto", marginTop: 0 }}
            >
              Frameld alle
            </button>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
            {participants.map((participant) => (
              <label
                key={participant.playerId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  padding: 14,
                  border: "1px solid #e1e8e3",
                  borderRadius: 12,
                  background: participant.isRegistered ? "#f3f9f4" : "#f4f4f4",
                }}
              >
                <span>
                  <strong>{participant.playerName}</strong>
                  <small
                    style={{
                      display: "block",
                      marginTop: 4,
                      color: "#78827d",
                    }}
                  >
                    Handicap {participant.currentHandicapIndex ?? "mangler"}
                  </small>
                </span>

                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 700,
                  }}
                >
                  {participant.isRegistered ? "Deltager" : "Meldt fra"}
                  <input
                    type="checkbox"
                    checked={participant.isRegistered}
                    onChange={(event) =>
                      setParticipantRegistered(
                        participant.playerId,
                        event.target.checked
                      )
                    }
                    disabled={isLocked}
                  />
                </span>
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={handleSaveParticipants}
            disabled={saving || isLocked || participants.length === 0}
            className="login-submit-button"
            style={{ maxWidth: 360 }}
          >
            {saving ? "Gemmer deltagere..." : "Gem deltagerliste"}
          </button>
        </>
      )}
    </section>
  );
}

function FlightAdmin({ season = 2027 }) {
  const [rounds, setRounds] = useState([]);
  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [selectedRound, setSelectedRound] = useState(null);
  const [flights, setFlights] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [newFlight, setNewFlight] = useState({
    flightNumber: "",
    name: "",
    teeTime: "",
  });
  const [loading, setLoading] = useState(true);
  const [savingFlightId, setSavingFlightId] = useState(null);
  const [creatingFlight, setCreatingFlight] = useState(false);
  const [savingStartList, setSavingStartList] = useState(false);
  const [assigningMarkers, setAssigningMarkers] = useState(false);
  const [publishingRound, setPublishingRound] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadRounds() {
      setLoading(true);
      try {
        setRounds(await getSeasonRoundsForFlights(season));
      } catch (error) {
        console.error("Fejl ved hentning af runder til bolde:", error);
        setErrorMessage(error.message ?? "Runderne kunne ikke hentes.");
      } finally {
        setLoading(false);
      }
    }
    loadRounds();
  }, [season]);

  async function loadFlightData(roundId) {
    if (!roundId) return;
    setLoading(true);
    setMessage("");
    setErrorMessage("");

    try {
      const result = await getFlightAdminData({ season, roundId });
      setSelectedRound(result.round);
      setFlights(result.flights);
      setParticipants(result.registeredParticipants);

      const nextDrafts = {};
      result.flights.forEach((flight) => {
        nextDrafts[flight.id] = {
          name: flight.name,
          flightNumber: flight.flight_number,
          teeTime: flight.tee_time?.slice(0, 5) ?? "",
          playerIds: [0, 1, 2, 3].map(
            (index) => flight.players[index]?.playerId ?? ""
          ),
        };
      });
      setDrafts(nextDrafts);
    } catch (error) {
      console.error("Fejl ved hentning af bolde:", error);
      setErrorMessage(error.message ?? "Boldene kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectRound(roundId) {
    setSelectedRoundId(roundId);
    setSelectedRound(null);
    setFlights([]);
    setParticipants([]);
    setDrafts({});
    if (roundId) await loadFlightData(roundId);
  }

  function updateDraft(flightId, field, value) {
    setDrafts((current) => ({
      ...current,
      [flightId]: { ...current[flightId], [field]: value },
    }));
    setMessage("");
    setErrorMessage("");
  }

  function updatePlayerSlot(flightId, slotIndex, playerId) {
    setDrafts((current) => {
      const playerIds = [...current[flightId].playerIds];
      playerIds[slotIndex] = playerId;
      return {
        ...current,
        [flightId]: { ...current[flightId], playerIds },
      };
    });
    setMessage("");
    setErrorMessage("");
  }

  const selectedPlayerIds = new Set(
    Object.values(drafts).flatMap((draft) => draft.playerIds.filter(Boolean))
  );

  const summary = summarizeFlightSetup({
    flights: flights.map((flight) => ({
      ...flight,
      players: (drafts[flight.id]?.playerIds ?? [])
        .filter(Boolean)
        .map((playerId) => ({ playerId })),
    })),
    registeredParticipants: participants,
  });

  const isLocked = Boolean(selectedRound?.locked_at);

  async function handleCreateFlight(event) {
    event.preventDefault();
    if (!selectedRoundId) return;
    setCreatingFlight(true);
    setMessage("");
    setErrorMessage("");

    try {
      const created = await createFlight({
        roundId: selectedRoundId,
        flightNumber: newFlight.flightNumber,
        name: newFlight.name,
        teeTime: newFlight.teeTime,
      });
      setNewFlight({ flightNumber: "", name: "", teeTime: "" });
      setMessage(`${created.name} er oprettet.`);
      await loadFlightData(selectedRoundId);
    } catch (error) {
      console.error("Fejl ved oprettelse af bold:", error);
      setErrorMessage(error.message ?? "Bolden kunne ikke oprettes.");
    } finally {
      setCreatingFlight(false);
    }
  }

  async function handleSaveFlight(flightId) {
    const draft = drafts[flightId];
    if (!draft) return;
    setSavingFlightId(flightId);
    setMessage("");
    setErrorMessage("");

    try {
      const saved = await updateFlight({
        flightId,
        name: draft.name,
        flightNumber: draft.flightNumber,
        teeTime: draft.teeTime,
      });
      setMessage(`${saved.name} er gemt.`);
      await loadFlightData(selectedRoundId);
    } catch (error) {
      console.error("Fejl ved gemning af bold:", error);
      setErrorMessage(error.message ?? "Bolden kunne ikke gemmes.");
    } finally {
      setSavingFlightId(null);
    }
  }

  async function handleDeleteFlight(flight) {
    const draft = drafts[flight.id];
    if (draft?.playerIds.some(Boolean)) {
      setErrorMessage("Fjern spillerne og gem startlisten, før bolden slettes.");
      return;
    }
    if (!window.confirm(`Vil du slette ${flight.name}?`)) return;

    setSavingFlightId(flight.id);
    try {
      await deleteEmptyFlight(flight.id);
      setMessage(`${flight.name} er slettet.`);
      await loadFlightData(selectedRoundId);
    } catch (error) {
      setErrorMessage(error.message ?? "Bolden kunne ikke slettes.");
    } finally {
      setSavingFlightId(null);
    }
  }

  async function handleSaveStartList() {
    setSavingStartList(true);
    setMessage("");
    setErrorMessage("");

    try {
      const allIds = Object.values(drafts).flatMap((draft) =>
        draft.playerIds.filter(Boolean)
      );
      if (new Set(allIds).size !== allIds.length) {
        throw new Error("En spiller er valgt i flere bolde.");
      }

      await saveFlightPlayers({
        roundId: selectedRoundId,
        flights: flights.map((flight) => ({
          flightId: flight.id,
          playerIds: drafts[flight.id]?.playerIds ?? [],
        })),
      });
      setMessage("Startlisten er gemt.");
      await loadFlightData(selectedRoundId);
    } catch (error) {
      console.error("Fejl ved gemning af startliste:", error);
      setErrorMessage(error.message ?? "Startlisten kunne ikke gemmes.");
    } finally {
      setSavingStartList(false);
    }
  }

  async function handleAssignMarkers() {
    if (!selectedRoundId || flights.length === 0) return;

    const missingNumbers = flights
      .map((flight) => Number(drafts[flight.id]?.flightNumber))
      .filter((flightNumber) => !Number.isInteger(flightNumber));

    if (missingNumbers.length > 0) {
      setErrorMessage("Alle bolde skal have et gyldigt boldnummer først.");
      return;
    }

    const confirmed = window.confirm(
      "Vil du tilknytte bold-login automatisk ud fra boldnumrene?"
    );
    if (!confirmed) return;

    setAssigningMarkers(true);
    setMessage("");
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc(
        "assign_round_markers",
        { requested_round_id: selectedRoundId }
      );

      if (error) throw error;

      setMessage(`${data ?? 0} markørlogin er tilknyttet.`);
      await loadFlightData(selectedRoundId);
    } catch (error) {
      console.error("Fejl ved tilknytning af markørlogin:", error);
      setErrorMessage(
        error.message ?? "Markørlogin kunne ikke tilknyttes."
      );
    } finally {
      setAssigningMarkers(false);
    }
  }

  async function handleValidateAndPublishRound() {
    if (!selectedRoundId) return;

    const confirmed = window.confirm(
      "Vil du validere hele rundeopsætningen og publicere runden som klar?"
    );
    if (!confirmed) return;

    setPublishingRound(true);
    setMessage("");
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc(
        "validate_and_publish_round",
        { requested_round_id: selectedRoundId }
      );

      if (error) throw error;

      setMessage(
        `Runden er publiceret som klar. ${data?.registered_players ?? 0} spillere, ${data?.flights ?? 0} bolde og ${data?.marker_logins ?? 0} markørlogin er valideret.`
      );
      await loadFlightData(selectedRoundId);
    } catch (error) {
      console.error("Fejl ved validering og publicering:", error);
      setErrorMessage(
        error.message ?? "Runden kunne ikke valideres og publiceres."
      );
    } finally {
      setPublishingRound(false);
    }
  }

  return (
    <section
      style={{
        marginTop: 24,
        padding: 20,
        border: "1px solid #d8e4db",
        borderRadius: 16,
        background: "#ffffff",
      }}
    >
      <p className="eyebrow">TGT {season}</p>
      <h2 style={{ marginTop: 0 }}>Boldadministration</h2>
      <p className="description">
        Opret bolde, angiv starttider og placér kun de tilmeldte spillere.
        Rækkefølgen i felterne bliver spillerens spilleorden.
      </p>

      <select
        value={selectedRoundId}
        onChange={(event) => handleSelectRound(event.target.value)}
        className="form-input"
        style={{ maxWidth: 560 }}
      >
        <option value="">Vælg runde</option>
        {rounds.map((round) => (
          <option key={round.id} value={round.id}>
            Runde {round.round_number} · {round.name}
          </option>
        ))}
      </select>

      {loading && <div className="status-box">Henter boldopsætning...</div>}

      {errorMessage && (
        <div className="error-box" style={{ margin: "18px 0 0" }}>
          {errorMessage}
        </div>
      )}

      {message && (
        <div
          style={{
            marginTop: 18,
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

      {!loading && selectedRound && (
        <>
          <div className="flight-information" style={{ marginTop: 18 }}>
            <div><span>Bolde</span><strong>{summary.totalFlights}</strong></div>
            <div><span>Tilmeldte</span><strong>{summary.registeredPlayers}</strong></div>
            <div><span>Placerede</span><strong>{selectedPlayerIds.size}</strong></div>
            <div><span>Uplacerede</span><strong>{summary.unassignedPlayers.length}</strong></div>
            <div><span>Mangler starttid</span><strong>{summary.flightsWithoutTeeTime}</strong></div>
            <div><span>Rundestatus</span><strong>{selectedRound.status}</strong></div>
          </div>

          {summary.unassignedPlayers.length > 0 && (
            <div className="status-box" style={{ margin: "18px 0 0" }}>
              <strong>Uplacerede spillere:</strong>{" "}
              {summary.unassignedPlayers
                .map((participant) => participant.playerName)
                .join(", ")}
            </div>
          )}

          {isLocked && (
            <div className="error-box" style={{ margin: "18px 0 0" }}>
              Runden er låst. Boldopsætningen kan ikke ændres.
            </div>
          )}

          <div style={{ display: "grid", gap: 14, marginTop: 20 }}>
            {flights.map((flight) => {
              const draft = drafts[flight.id];
              if (!draft) return null;

              return (
                <article
                  key={flight.id}
                  style={{
                    padding: 16,
                    border: "1px solid #e1e8e3",
                    borderRadius: 14,
                    background: "#fafbf9",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "110px 1fr 150px",
                      gap: 10,
                    }}
                  >
                    <input
                      type="number"
                      min="1"
                      value={draft.flightNumber}
                      onChange={(event) =>
                        updateDraft(flight.id, "flightNumber", event.target.value)
                      }
                      className="form-input"
                      disabled={isLocked}
                    />
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        updateDraft(flight.id, "name", event.target.value)
                      }
                      className="form-input"
                      placeholder="Boldnavn"
                      disabled={isLocked}
                    />
                    <input
                      type="time"
                      value={draft.teeTime}
                      onChange={(event) =>
                        updateDraft(flight.id, "teeTime", event.target.value)
                      }
                      className="form-input"
                      disabled={isLocked}
                    />
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, minmax(150px, 1fr))",
                      gap: 10,
                      marginTop: 12,
                    }}
                  >
                    {draft.playerIds.map((playerId, slotIndex) => (
                      <select
                        key={slotIndex}
                        value={playerId}
                        onChange={(event) =>
                          updatePlayerSlot(
                            flight.id,
                            slotIndex,
                            event.target.value
                          )
                        }
                        className="form-input"
                        disabled={isLocked}
                      >
                        <option value="">Plads {slotIndex + 1}</option>
                        {participants.map((participant) => {
                          const usedElsewhere =
                            selectedPlayerIds.has(participant.playerId) &&
                            participant.playerId !== playerId;
                          return (
                            <option
                              key={participant.playerId}
                              value={participant.playerId}
                              disabled={usedElsewhere}
                            >
                              {participant.playerName}
                            </option>
                          );
                        })}
                      </select>
                    ))}
                  </div>

                  <div
                    style={{
                      marginTop: 12,
                      padding: 10,
                      borderRadius: 10,
                      background:
                        flight.markers?.length > 0 ? "#e7f6eb" : "#fff4dd",
                      color:
                        flight.markers?.length > 0 ? "#176334" : "#8a5a16",
                      fontWeight: 700,
                    }}
                  >
                    {flight.markers?.length > 0
                      ? `Markørlogin tilknyttet: bold${draft.flightNumber}@tgt.dk`
                      : `Markørlogin mangler: bold${draft.flightNumber}@tgt.dk`}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 10,
                      marginTop: 12,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleDeleteFlight(flight)}
                      disabled={isLocked || savingFlightId === flight.id}
                      className="login-cancel-button"
                      style={{ width: "auto", marginTop: 0 }}
                    >
                      Slet tom bold
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveFlight(flight.id)}
                      disabled={isLocked || savingFlightId === flight.id}
                      className="login-submit-button"
                      style={{ width: "auto", marginTop: 0 }}
                    >
                      {savingFlightId === flight.id ? "Gemmer..." : "Gem bold"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleSaveStartList}
            disabled={isLocked || savingStartList || flights.length === 0}
            className="login-submit-button"
            style={{ maxWidth: 360 }}
          >
            {savingStartList ? "Gemmer startliste..." : "Gem hele startlisten"}
          </button>

          <button
            type="button"
            onClick={handleAssignMarkers}
            disabled={isLocked || assigningMarkers || flights.length === 0}
            className="login-submit-button"
            style={{ maxWidth: 360, marginLeft: 10 }}
          >
            {assigningMarkers
              ? "Tilknytter markørlogin..."
              : "Tilknyt markørlogin"}
          </button>

          <button
            type="button"
            onClick={handleValidateAndPublishRound}
            disabled={
              isLocked ||
              publishingRound ||
              flights.length === 0 ||
              selectedRound.status === "ready"
            }
            className="login-submit-button"
            style={{ maxWidth: 360, marginLeft: 10 }}
          >
            {publishingRound
              ? "Validerer og publicerer..."
              : selectedRound.status === "ready"
                ? "Runden er publiceret"
                : "Validér og publicér runde"}
          </button>

          <form
            onSubmit={handleCreateFlight}
            style={{
              marginTop: 26,
              paddingTop: 22,
              borderTop: "1px solid #e1e8e3",
            }}
          >
            <p className="eyebrow">Ny startgruppe</p>
            <h3 style={{ margin: "5px 0 14px" }}>Opret bold</h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "110px 1fr 150px",
                gap: 10,
              }}
            >
              <input
                type="number"
                min="1"
                value={newFlight.flightNumber}
                onChange={(event) =>
                  setNewFlight((current) => ({
                    ...current,
                    flightNumber: event.target.value,
                  }))
                }
                className="form-input"
                placeholder="Nr."
                required
              />
              <input
                value={newFlight.name}
                onChange={(event) =>
                  setNewFlight((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="form-input"
                placeholder="Boldnavn, fx Bold 1"
              />
              <input
                type="time"
                value={newFlight.teeTime}
                onChange={(event) =>
                  setNewFlight((current) => ({
                    ...current,
                    teeTime: event.target.value,
                  }))
                }
                className="form-input"
              />
            </div>
            <button
              type="submit"
              disabled={isLocked || creatingFlight}
              className="login-submit-button"
              style={{ maxWidth: 300 }}
            >
              {creatingFlight ? "Opretter..." : "Opret bold"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function AdminClosestToPin({ session, onLogout }) {
  const [roundId, setRoundId] = useState(null);
  const [roundLocks, setRoundLocks] = useState([]);
  const [changingRoundId, setChangingRoundId] = useState(null);
  const [seasonArchive, setSeasonArchive] = useState(null);
  const [finalizingSeason, setFinalizingSeason] = useState(false);
  const [season2027, setSeason2027] = useState(null);
  const [season2027PlayerCount, setSeason2027PlayerCount] = useState(0);
  const [creatingSeason2027, setCreatingSeason2027] = useState(false);
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
  const [adminSeasonTab, setAdminSeasonTab] = useState("2026");
  const [admin2027Tab, setAdmin2027Tab] = useState("overview");

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const { data: round, error: roundError } = await supabase
        .from("rounds")
        .select(`
          id,
          tournament_id,
          round_number,
          name,
          played_at,
          locked_at,
          locked_by,
          tournaments!inner (
            season
          )
        `)
        .eq("tournaments.season", 2026)
        .in("round_number", [6, 7])
        .order("round_number", { ascending: true });

      if (roundError) throw roundError;

      const rounds = round ?? [];
      setRoundLocks(rounds);

      const roundSix = rounds.find(
        (item) => item.round_number === 6
      );

      if (!roundSix) {
        throw new Error("Runde 6 blev ikke fundet.");
      }

      setRoundId(roundSix.id);

      const { data: archive, error: archiveError } = await supabase
        .from("season_champions")
        .select(`
          id,
          season,
          individual_champion_name,
          individual_score,
          team_champion_name,
          finalized_at
        `)
        .eq("tournament_id", roundSix.tournament_id)
        .maybeSingle();

      if (archiveError) throw archiveError;
      setSeasonArchive(archive);

      const { data: nextSeason, error: nextSeasonError } = await supabase
        .from("tournaments")
        .select(`
          id,
          name,
          season,
          status,
          is_public,
          locked_at
        `)
        .eq("season", 2027)
        .maybeSingle();

      if (nextSeasonError) throw nextSeasonError;
      setSeason2027(nextSeason);

      if (nextSeason?.id) {
        const { count, error: playerCountError } = await supabase
          .from("players")
          .select("id", { count: "exact", head: true })
          .eq("tournament_id", nextSeason.id)
          .eq("active", true);

        if (playerCountError) throw playerCountError;
        setSeason2027PlayerCount(count ?? 0);
      } else {
        setSeason2027PlayerCount(0);
      }

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
        .eq("round_id", roundSix.id)
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

  async function handleRoundLock(roundData) {
    const isLocked = Boolean(roundData.locked_at);
    const actionText = isLocked ? "genåbne" : "låse";

    const confirmed = window.confirm(
      `Vil du ${actionText} Runde ${roundData.round_number}?`
    );

    if (!confirmed) return;

    setChangingRoundId(roundData.id);
    setMessage("");
    setErrorMessage("");

    try {
      const functionName = isLocked
        ? "unlock_tgt_round"
        : "lock_tgt_round";

      const { error } = await supabase.rpc(functionName, {
        requested_round_id: roundData.id,
      });

      if (error) throw error;

      setMessage(
        `Runde ${roundData.round_number} er ${
          isLocked ? "genåbnet" : "låst"
        }.`
      );
      await loadAdminData();
    } catch (error) {
      console.error("Fejl ved ændring af rundelås:", error);
      setErrorMessage(
        error.message ?? "Rundens låsestatus kunne ikke ændres."
      );
    } finally {
      setChangingRoundId(null);
    }
  }

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

  async function handleCreateSeason2027() {
    const confirmed = window.confirm(
      "Vil du oprette TGT 2027 som kladde og kopiere de aktive spillere og regler fra TGT 2026?"
    );

    if (!confirmed) return;

    setCreatingSeason2027(true);
    setMessage("");
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc(
        "create_next_tgt_season",
        {
          source_season: 2026,
          new_season: 2027,
        }
      );

      if (error) throw error;

      setMessage(
        `TGT 2027 er oprettet som kladde. Turneringens ID er ${data}.`
      );
      await loadAdminData();
    } catch (error) {
      console.error("Fejl ved oprettelse af TGT 2027:", error);
      setErrorMessage(
        error.message ?? "TGT 2027 kunne ikke oprettes."
      );
    } finally {
      setCreatingSeason2027(false);
    }
  }

  async function handleFinalizeSeason() {
    const roundSix = roundLocks.find(
      (roundData) => roundData.round_number === 6
    );
    const roundSeven = roundLocks.find(
      (roundData) => roundData.round_number === 7
    );

    if (!roundSix?.locked_at || !roundSeven?.locked_at) {
      setErrorMessage(
        "Både Runde 6 og Runde 7 skal være låst først."
      );
      return;
    }

    setFinalizingSeason(true);
    setMessage("");
    setErrorMessage("");

    try {
      const [finalData, teamResult] = await Promise.all([
        getFinalStandings({
          season: 2026,
          roundSixNumber: 6,
          roundSevenNumber: 7,
        }),
        getTeamLeaderboard({ season: 2026, roundNumber: 6 }),
      ]);

      if (!finalData.finalCompleted || !finalData.champion) {
        throw new Error(
          "Finalestillingen er ikke endelig. Alle 15 spillere skal have gennemført begge finalerunder."
        );
      }

      const teams = teamResult.leaderboard ?? [];
      if (
        teams.length !== 7 ||
        teams.some((team) => team.holesPlayed !== 18)
      ) {
        throw new Error(
          "Holdfinalen er ikke færdig. Alle syv hold skal have 18 gennemførte holdhuller."
        );
      }

      const teamChampion = teams[0];
      const confirmed = window.confirm(
        `Afslut og lås TGT 2026? Individuel mester: ${finalData.champion.playerName}. Holdmester: ${teamChampion.teamName}.`
      );
      if (!confirmed) return;

      const { error } = await supabase.rpc(
        "finalize_tgt_season",
        {
          requested_tournament_id: roundSix.tournament_id,
          requested_individual_champion_id:
            finalData.champion.playerId,
          requested_individual_score:
            finalData.champion.finalScore,
          requested_team_champion_id: teamChampion.teamId,
        }
      );
      if (error) throw error;

      setMessage("TGT 2026 er afsluttet og låst.");
      await loadAdminData();
    } catch (error) {
      console.error("Fejl ved sæsonafslutning:", error);
      setErrorMessage(
        error.message ?? "Sæsonen kunne ikke afsluttes."
      );
    } finally {
      setFinalizingSeason(false);
    }
  }

  return (
    <main className="marker-page">
      <section className="marker-card">
        <div className="marker-header">
          <div>
            <p className="eyebrow">TGT administration</p>
            <h1>TGT Administration</h1>
            <p className="description">
              Administrér finalerne i 2026 og klargør hele TGT 2027 fra ét samlet overblik.
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
            <nav
              aria-label="Administrationssæson"
              style={{
                display: "flex",
                gap: 10,
                padding: 8,
                borderRadius: 16,
                background: "#eef3ef",
                marginBottom: 18,
              }}
            >
              {[
                ["2026", "2026 Finale"],
                ["2027", "2027 Opsætning"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setAdminSeasonTab(value)}
                  className={
                    adminSeasonTab === value
                      ? "login-submit-button"
                      : "login-cancel-button"
                  }
                  style={{ flex: 1, marginTop: 0 }}
                >
                  {label}
                </button>
              ))}
            </nav>

            {adminSeasonTab === "2027" && season2027 && (
              <nav
                aria-label="TGT 2027 administration"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  padding: 10,
                  border: "1px solid #dce5de",
                  borderRadius: 14,
                  background: "#ffffff",
                  marginBottom: 22,
                  position: "sticky",
                  top: 10,
                  zIndex: 5,
                  boxShadow: "0 8px 24px rgba(16, 52, 37, 0.08)",
                }}
              >
                {[
                  ["overview", "Overblik"],
                  ["players", "Spillere"],
                  ["teams", "Hold"],
                  ["rounds", "Runder"],
                  ["participants", "Deltagere"],
                  ["flights", "Bolde"],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setAdmin2027Tab(value)}
                    className={
                      admin2027Tab === value
                        ? "login-submit-button"
                        : "login-cancel-button"
                    }
                    style={{ width: "auto", marginTop: 0 }}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            )}
            {adminSeasonTab === "2026" && (
              <>
            <section
              style={{
                padding: 20,
                border: "1px solid #d8e4db",
                borderRadius: 16,
                background: "#ffffff",
                marginBottom: 24,
              }}
            >
              <p className="eyebrow">Skrivebeskyttelse</p>
              <h2 style={{ marginTop: 0 }}>Lås og genåbn runder</h2>
              <p className="description">
                En låst runde kan ikke modtage, ændre eller slette scores og
                tættest-på-pinden-registreringer. Genåbn kun ved rettelser.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(250px, 1fr))",
                  gap: 14,
                  marginTop: 18,
                }}
              >
                {roundLocks.map((roundData) => {
                  const isLocked = Boolean(roundData.locked_at);

                  return (
                    <article
                      key={roundData.id}
                      style={{
                        padding: 18,
                        border: "1px solid #e0e8e2",
                        borderRadius: 14,
                        background: isLocked ? "#eef7f0" : "#fafbf9",
                      }}
                    >
                      <p className="eyebrow">
                        {formatDate(roundData.played_at)}
                      </p>
                      <h3 style={{ margin: "5px 0 8px" }}>
                        Runde {roundData.round_number}
                      </h3>
                      <strong
                        style={{
                          display: "block",
                          color: isLocked ? "#176334" : "#8a5a16",
                          marginBottom: 12,
                        }}
                      >
                        {isLocked ? "Låst" : "Åben"}
                      </strong>
                      {isLocked && (
                        <small
                          style={{
                            display: "block",
                            color: "#78827d",
                            marginBottom: 12,
                          }}
                        >
                          Låst {new Date(roundData.locked_at).toLocaleString("da-DK")}
                        </small>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRoundLock(roundData)}
                        disabled={changingRoundId === roundData.id}
                        className={
                          isLocked
                            ? "login-cancel-button"
                            : "login-submit-button"
                        }
                        style={{ marginTop: 0 }}
                      >
                        {changingRoundId === roundData.id
                          ? "Arbejder..."
                          : isLocked
                            ? `Genåbn Runde ${roundData.round_number}`
                            : `Lås Runde ${roundData.round_number}`}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>

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

              </>
            )}

            {adminSeasonTab === "2027" && (
              <>
                {admin2027Tab === "overview" && (
            <section
              style={{
                marginTop: 24,
                padding: 20,
                border: "1px solid #d8e4db",
                borderRadius: 16,
                background: season2027 ? "#eef7f0" : "#ffffff",
              }}
            >
              <p className="eyebrow">Ny sæson</p>
              <h2 style={{ marginTop: 0 }}>
                {season2027 ? "TGT 2027 er oprettet" : "Opret TGT 2027"}
              </h2>

              {season2027 ? (
                <div className="flight-information" style={{ marginTop: 18 }}>
                  <div>
                    <span>Status</span>
                    <strong>{season2027.status}</strong>
                  </div>
                  <div>
                    <span>Offentlig</span>
                    <strong>{season2027.is_public ? "Ja" : "Nej"}</strong>
                  </div>
                  <div>
                    <span>Aktive spillere</span>
                    <strong>{season2027PlayerCount}</strong>
                  </div>
                  <div>
                    <span>Opsætning</span>
                    <strong>Kladde</strong>
                  </div>
                </div>
              ) : (
                <>
                  <p className="description">
                    Opretter TGT 2027 som en privat kladde, kopierer reglerne
                    og alle aktive spillere fra 2026. Hold, runder, datoer,
                    bolde, scores og historiske resultater kopieres ikke.
                  </p>

                  <button
                    type="button"
                    onClick={handleCreateSeason2027}
                    disabled={creatingSeason2027}
                    className="login-submit-button"
                    style={{ maxWidth: 420 }}
                  >
                    {creatingSeason2027
                      ? "Opretter TGT 2027..."
                      : "Opret TGT 2027"}
                  </button>
                </>
              )}
            </section>

                )}

                {season2027 && admin2027Tab === "players" && (
                  <SeasonPlayersAdmin season={2027} />
                )}
                {season2027 && admin2027Tab === "teams" && (
                  <SeasonTeamsAdmin season={2027} />
                )}
                {season2027 && admin2027Tab === "rounds" && (
                  <SeasonRoundsAdmin season={2027} />
                )}
                {season2027 && admin2027Tab === "participants" && (
                  <RoundParticipantsAdmin season={2027} />
                )}
                {season2027 && admin2027Tab === "flights" && (
                  <FlightAdmin season={2027} />
                )}
              </>
            )}

            {adminSeasonTab === "2026" && (
              <>

            <section
              style={{
                marginTop: 24,
                padding: 20,
                border: "1px solid #d8e4db",
                borderRadius: 16,
                background: seasonArchive ? "#eef7f0" : "#ffffff",
              }}
            >
              <p className="eyebrow">Sæsonafslutning</p>
              <h2 style={{ marginTop: 0 }}>
                {seasonArchive
                  ? "TGT 2026 er afsluttet"
                  : "Afslut og lås TGT 2026"}
              </h2>

              {seasonArchive ? (
                <div className="flight-information" style={{ marginTop: 18 }}>
                  <div>
                    <span>Individuel mester</span>
                    <strong>{seasonArchive.individual_champion_name}</strong>
                  </div>
                  <div>
                    <span>Slutscore</span>
                    <strong>{formatScore(seasonArchive.individual_score)}</strong>
                  </div>
                  <div>
                    <span>Holdmester</span>
                    <strong>{seasonArchive.team_champion_name}</strong>
                  </div>
                  <div>
                    <span>Afsluttet</span>
                    <strong>
                      {new Date(
                        seasonArchive.finalized_at
                      ).toLocaleString("da-DK")}
                    </strong>
                  </div>
                </div>
              ) : (
                <>
                  <p className="description">
                    Begge runder skal være låst. Systemet kontrollerer
                    derefter alle 15 spillere og alle syv hold, gemmer
                    mestrene permanent og låser sæsonen.
                  </p>
                  <button
                    type="button"
                    onClick={handleFinalizeSeason}
                    disabled={
                      finalizingSeason ||
                      roundLocks.length !== 2 ||
                      roundLocks.some(
                        (roundData) => !roundData.locked_at
                      )
                    }
                    className="login-submit-button"
                    style={{ maxWidth: 420 }}
                  >
                    {finalizingSeason
                      ? "Afslutter TGT 2026..."
                      : "Afslut og lås TGT 2026"}
                  </button>
                  {roundLocks.some(
                    (roundData) => !roundData.locked_at
                  ) && (
                    <div className="status-box" style={{ margin: "16px 0 0" }}>
                      Runde 6 og Runde 7 skal begge være låst først.
                    </div>
                  )}
                </>
              )}
            </section>

              </>
            )}

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
  const [availableAssignments, setAvailableAssignments] = useState([]);
  const [selectedRoundNumber, setSelectedRoundNumber] = useState(null);
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
              course_id,
              locked_at,
              locked_by
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

      const assignments = (markerRows ?? [])
        .map((row) => row.flights)
        .filter((flight) => flight?.rounds)
        .sort(
          (a, b) =>
            a.rounds.round_number -
            b.rounds.round_number
        );

      setAvailableAssignments(assignments);

      if (assignments.length === 0) {
        setAssignmentError(
          "Dette login er ikke knyttet til en aktiv bold."
        );
        setLoading(false);
        return;
      }

      if (selectedRoundNumber === null) {
        if (assignments.length === 1) {
          setSelectedRoundNumber(
            assignments[0].rounds.round_number
          );
        }
        setLoading(false);
        return;
      }

      const flight = assignments.find(
        (item) =>
          item.rounds.round_number ===
          selectedRoundNumber
      );

      if (!flight) {
        setAssignmentError(
          "Den valgte runde er ikke knyttet til dette login."
        );
        setLoading(false);
        return;
      }

      setAssignment(flight);
      setSelectedHole(1);
      setSaveMessage("");
      setSaveError("");

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
  }, [session.user.id, selectedRoundNumber]);

  function handleSelectRound(roundNumber) {
    setAssignment(null);
    setPlayers([]);
    setHoles([]);
    setExistingScores([]);
    setDraftScores({});
    setClosestEntry(null);
    setClosestPlayerId("");
    setClosestDistance("");
    setAssignmentError("");
    setSelectedRoundNumber(roundNumber);
  }

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

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {assignment && availableAssignments.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setAssignment(null);
                  setSelectedRoundNumber(null);
                }}
                className="logout-button"
              >
                Skift runde
              </button>
            )}
            <button
              type="button"
              onClick={onLogout}
              className="logout-button"
            >
              Log ud
            </button>
          </div>
        </div>

        {loading && (
          <div className="status-box">
            Henter bold, spillere og scorekort...
          </div>
        )}

        {!loading &&
          !assignmentError &&
          selectedRoundNumber === null &&
          availableAssignments.length > 1 && (
            <section style={{ padding: 22 }}>
              <p className="eyebrow">Vælg spilledag</p>
              <h2 style={{ margin: "4px 0 8px" }}>
                Hvilken runde vil du føre score for?
              </h2>
              <p className="description">
                Det samme bold-login kan bruges på begge finaledage.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 14,
                  marginTop: 20,
                }}
              >
                {availableAssignments.map((flight) => (
                  <button
                    type="button"
                    key={flight.id}
                    onClick={() =>
                      handleSelectRound(
                        flight.rounds.round_number
                      )
                    }
                    style={{
                      padding: 20,
                      textAlign: "left",
                      border: "1px solid #d6e1d9",
                      borderRadius: 16,
                      background: "#f7faf7",
                      color: "#17271f",
                    }}
                  >
                    <span className="eyebrow">
                      {formatDate(flight.rounds.played_at)}
                    </span>
                    <strong
                      style={{
                        display: "block",
                        marginTop: 8,
                        fontSize: 20,
                      }}
                    >
                      Runde {flight.rounds.round_number} · {flight.name}
                    </strong>
                    <span
                      style={{
                        display: "block",
                        marginTop: 8,
                        color: "#68756f",
                      }}
                    >
                      Starttid {formatTime(flight.tee_time)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
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

              {assignment.rounds?.locked_at && (
                <div className="error-box" style={{ margin: "20px 20px 0" }}>
                  <strong>Runden er låst</strong>
                  <span>
                    Score og tættest på pinden kan ikke ændres. Kontakt admin,
                    hvis runden skal genåbnes.
                  </span>
                </div>
              )}

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
                          disabled={Boolean(assignment.rounds?.locked_at)}
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
                        disabled={
                          closestLoading ||
                          Boolean(assignment.rounds?.locked_at)
                        }
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
                        disabled={
                          closestLoading ||
                          Boolean(assignment.rounds?.locked_at)
                        }
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
                          Boolean(assignment.rounds?.locked_at) ||
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
                          disabled={
                          closestLoading ||
                          Boolean(assignment.rounds?.locked_at)
                        }
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
                    disabled={
                      savingScores ||
                      Boolean(assignment.rounds?.locked_at)
                    }
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