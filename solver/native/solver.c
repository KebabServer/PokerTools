/*
 * Float64 GTO traversal and EV-only evaluation for TurnRiverLab.
 * This source-backed module shares the typed game metadata and numerical state
 * packed by compiled-traversal.js. It has no static or imported mutable state.
 */
typedef unsigned char u8;
typedef unsigned short u16;
typedef short i16;

typedef struct {
    int length;
    const u8 *card0, *card1;
    const i16 *opponent_index;
} Player;

typedef struct {
    const u16 *mine, *opponent, *start, *weak_end, *tie_end;
    int group_count;
} Payoff;

typedef struct {
    int child, card;
    const u16 *const *maps;  /* two maps per member, null means identity */
    int size;
    const double *weight;
} ChanceGroup;

typedef struct {
    int kind, actor, actions;
    const int *children;
    int group_count;
    const ChanceGroup *groups;
    double *current, *regret, *average;
    const double *entropy, *log_policy;
    const u8 *valid[2];
    const Payoff *payoff[2];
    int fold_winner, committed[2], turn, river;
    double *previous_delta;
    const u8 *pruned;
} Node;

typedef struct {
    const u8 *locked;
    const u16 *suit_row;
    int locked_actions;  /* -1 if any row is free; otherwise a bit mask */
    int frequency_units;
} Decision;

typedef struct {
    const Node *nodes;
    const Decision *decisions;
    const Player *mine, *opponent;
    int target;
    double pot;
    double *scratch, *end;
    double average_weight, positive_discount, negative_discount, tie_floor;
    int variant, fused, profile, unrestricted;
} Game;

_Static_assert(sizeof(Node) == 22 * 4, "Node table ABI");
_Static_assert(sizeof(ChanceGroup) == 5 * 4, "Chance table ABI");
_Static_assert(sizeof(Decision) == 4 * 4, "Decision table ABI");
_Static_assert(sizeof(Payoff) == 6 * 4 && sizeof(Player) == 4 * 4, "Payoff table ABI");

static double *take(Game *g, int count) {
    if (g->end - g->scratch < count) return (double *)0;
    double *start = g->scratch;
    g->scratch += count;
    return start;
}

static int allows(const Player *player, int i, int card) {
    return player->card0[i] != card && player->card1[i] != card;
}

static int disjoint(const Player *other, int j, int a, int b) {
    return allows(other, j, a) && allows(other, j, b);
}

static void zero(double *values, int count) {
    for (int i = 0; i < count; ++i) values[i] = 0;
}

static void terminal(const Game *g, const Node *node, const double *reach, double *out) {
    const Player *mine = g->mine, *opponent = g->opponent;
    const u8 *mine_valid = node->valid[g->target], *opp_valid = node->valid[1 - g->target];
    double cards[52] = {0};
    double total = 0;
    zero(out, mine->length);
    for (int i = 0; i < opponent->length; ++i) {
        if (opp_valid && !opp_valid[i]) continue;
        double w = reach[i];
        total += w;
        cards[opponent->card0[i]] += w;
        cards[opponent->card1[i]] += w;
    }
    if (total == 0) return;
    double win = g->pot / 2 + node->committed[1 - g->target];
    double loss = -g->pot / 2 - node->committed[g->target];
    if (node->fold_winner != -1) {
        double value = node->fold_winner == g->target ? win : loss;
        for (int i = 0; i < mine->length; ++i) {
            if (mine_valid && !mine_valid[i]) continue;
            int a = mine->card0[i], b = mine->card1[i], same = mine->opponent_index[i];
            double mass = total - cards[a] - cards[b] + (same < 0 ? 0 : reach[same]);
            if (mass < total * 1e-12) {
                mass = 0;
                for (int j = 0; j < opponent->length; ++j) {
                    if ((!opp_valid || opp_valid[j]) && disjoint(opponent, j, a, b)) mass += reach[j];
                }
            }
            out[i] = value * mass;
        }
        return;
    }
    const Payoff *layout = node->payoff[g->target];
    double weaker_cards[52] = {0}, tied_cards[52] = {0};
    double weaker_total = 0;
    double tie = (node->committed[1 - g->target] - node->committed[g->target]) / 2.0;
    int cursor = 0;
    for (int group = 0; group < layout->group_count; ++group) {
        int weak_end = layout->weak_end[group], tie_end = layout->tie_end[group];
        while (cursor < weak_end) {
            int j = layout->opponent[cursor++];
            double w = reach[j];
            weaker_total += w;
            weaker_cards[opponent->card0[j]] += w;
            weaker_cards[opponent->card1[j]] += w;
        }
        double tied_total = 0;
        for (int pos = weak_end; pos < tie_end; ++pos) {
            int j = layout->opponent[pos];
            double w = reach[j];
            tied_total += w;
            tied_cards[opponent->card0[j]] += w;
            tied_cards[opponent->card1[j]] += w;
        }
        for (int pos = layout->start[group]; pos < layout->start[group + 1]; ++pos) {
            int i = layout->mine[pos], a = mine->card0[i], b = mine->card1[i], same = mine->opponent_index[i];
            double duplicate = same < 0 ? 0 : reach[same];
            double mass = total - cards[a] - cards[b] + duplicate;
            if (mass < total * 1e-12) {
                double value = 0;
                for (int j = 0; j < opponent->length; ++j) {
                    if ((!opp_valid || opp_valid[j]) && disjoint(opponent, j, a, b)) {
                        // Recover the opponent's rank relative to this bucket only for the rare
                        // cancellation case. The legal sorted list has every available hand.
                        value += reach[j];
                    }
                }
                double weak = 0, tied = 0;
                for (int k = 0; k < tie_end; ++k) {
                    int j = layout->opponent[k];
                    if (disjoint(opponent, j, a, b)) {
                        if (k < weak_end) weak += reach[j];
                        else tied += reach[j];
                    }
                }
                out[i] = weak * win + tied * tie + (value - weak - tied) * loss;
            } else {
                double weak = weaker_total - weaker_cards[a] - weaker_cards[b];
                double tied = tied_total - tied_cards[a] - tied_cards[b] + duplicate;
                out[i] = weak * win + tied * tie + (mass - weak - tied) * loss;
            }
        }
        while (cursor < tie_end) {
            int j = layout->opponent[cursor++];
            double w = reach[j];
            int a = opponent->card0[j], b = opponent->card1[j];
            weaker_total += w;
            weaker_cards[a] += w;
            weaker_cards[b] += w;
            tied_cards[a] = tied_cards[b] = 0;
        }
    }
}

static int is_locked(const Decision *decision, int hand) {
    return decision->locked && decision->locked[hand];
}

static void average_policy(const Node *node, const Decision *decision, int n, double *policy) {
    int a = node->actions, units = decision->frequency_units;
    for (int i = 0; i < n; ++i) {
        int h = decision->suit_row ? decision->suit_row[i] : i;
        const double *current = node->current + h * a, *average = node->average + h * a;
        double *row = policy + i * a;
        double sum = 0;
        int fixed = is_locked(decision, h);
        if (!fixed) {
            for (int k = 0; k < a; ++k) {
                if (!node->pruned || !node->pruned[k]) sum += average[k];
            }
        }
        for (int k = 0; k < a; ++k) {
            row[k] = node->pruned && node->pruned[k] ? 0 : sum > 0 ? average[k] / sum : current[k];
        }
        if (!units || fixed) continue;
        double remainders[12];
        int remaining = units;
        for (int k = 0; k < a; ++k) {
            double target = row[k] * units;
            int whole = (int)target;
            remainders[k] = target - whole;
            row[k] = whole;
            remaining -= whole;
        }
        for (int j = 0; j < remaining; ++j) {
            int best = 0;
            for (int k = 1; k < a; ++k) {
                if (remainders[k] > remainders[best]) best = k;
            }
            row[best]++;
            remainders[best] = -1;
        }
        for (int k = 0; k < a; ++k) row[k] /= units;
    }
}

static void remap_add(double *out, const double *value, const u16 *map, int n) {
    if (map) {
        for (int i = 0; i < n; ++i) out[map[i]] += value[i];
    } else {
        for (int i = 0; i < n; ++i) out[i] += value[i];
    }
}

static int evaluate(Game *g, int id, const double *reach, double *out) {
    const Node *node = g->nodes + id;
    const Decision *decision = g->decisions + id;
    int n = g->mine->length, m = g->opponent->length;
    int vectors = 1 + g->profile + g->unrestricted;
    if (node->kind == 0) {
        terminal(g, node, reach, out);
        for (int v = 1; v < vectors; ++v) {
            for (int i = 0; i < n; ++i) out[v * n + i] = out[i];
        }
        return 1;
    }
    if (node->kind == 1 && node->actions == 1) return evaluate(g, node->children[0], reach, out);

    double *mark = g->scratch;
    double *value = take(g, n * vectors), *next = take(g, m);
    if (!value || !next) return 0;
    zero(out, n * vectors);
    if (node->kind == 2) {
        for (int k = 0; k < node->group_count; ++k) {
            const ChanceGroup *group = node->groups + k;
            for (int i = 0; i < m; ++i)
                next[i] = allows(g->opponent, i, group->card) ? reach[i] * *group->weight : 0;
            if (!evaluate(g, group->child, next, value)) return 0;
            for (int j = 0; j < group->size; ++j) {
                const u16 *map = group->maps[2 * j + g->target];
                for (int v = 0; v < vectors; ++v) remap_add(out + v * n, value + v * n, map, n);
            }
        }
    } else {
        int a = node->actions, own = node->actor == g->target;
        double *policy = take(g, a * (own ? n : m));
        if (!policy) return 0;
        average_policy(node, decision, own ? n : m, policy);
        if (!own) {
            for (int k = 0; k < a; ++k) {
                if (node->pruned && node->pruned[k]) continue;
                if (decision->locked_actions != -1 && !(decision->locked_actions & (1 << k))) continue;
                int any = 0;
                for (int i = 0; i < m; ++i) {
                    next[i] = reach[i] * policy[i * a + k];
                    any |= next[i] != 0;
                }
                if (!any) continue;
                if (!evaluate(g, node->children[k], next, value)) return 0;
                for (int i = 0; i < n * vectors; ++i) out[i] += value[i];
            }
        } else {
            int all_locked = decision->locked_actions != -1;
            double *unrestricted = out + n * (1 + g->profile);
            for (int k = 0; k < a; ++k) {
                // A current/pruned zero is still a legal deviation. Skip
                // only actions forbidden for all evaluated locked hands.
                if (!g->unrestricted && all_locked && !(decision->locked_actions & (1 << k))) continue;
                if (!evaluate(g, node->children[k], reach, value)) return 0;
                for (int i = 0; i < n; ++i) {
                    double p = policy[i * a + k];
                    if (all_locked || is_locked(decision, i)) out[i] += p * value[i];
                    else if (k == 0 || value[i] > out[i]) out[i] = value[i];
                    if (g->profile) out[n + i] += p * value[n + i];
                    if (g->unrestricted) {
                        double action = value[n * (1 + g->profile) + i];
                        if (k == 0 || action > unrestricted[i]) unrestricted[i] = action;
                    }
                }
            }
        }
    }
    g->scratch = mark;
    return 1;
}

static int train(Game *g, int id, const double *reach, const double *own_reach, double *out) {
    const Node *node = g->nodes + id;
    const Decision *decision = g->decisions + id;
    int n = g->mine->length, m = g->opponent->length;
    if (node->kind == 0) {
        terminal(g, node, reach, out);
        return 1;
    }
    if (node->kind == 1 && node->actions == 1) return train(g, node->children[0], reach, own_reach, out);

    double *mark = g->scratch;
    zero(out, n);
    if (node->kind == 2) {
        double *value = take(g, n), *next = take(g, m);
        double *own_next = own_reach ? take(g, n) : (double *)0;
        if (!value || !next || (own_reach && !own_next)) return 0;
        for (int k = 0; k < node->group_count; ++k) {
            const ChanceGroup *group = node->groups + k;
            double weight = *group->weight;
            for (int i = 0; i < m; ++i)
                next[i] = allows(g->opponent, i, group->card) ? reach[i] * weight : 0;
            if (own_next) {
                for (int i = 0; i < n; ++i)
                    own_next[i] = allows(g->mine, i, group->card) ? own_reach[i] * weight : 0;
            }
            if (!train(g, group->child, next, own_next, value)) return 0;
            for (int j = 0; j < group->size; ++j)
                remap_add(out, value, group->maps[2 * j + g->target], n);
        }
    } else {
        int a = node->actions, all_locked = decision->locked_actions != -1;
        if (node->actor != g->target) {
            double *value = take(g, n), *next = take(g, m);
            if (!value || !next) return 0;
            for (int k = 0; k < a; ++k) {
                if ((node->pruned && node->pruned[k]) ||
                    (all_locked && !(decision->locked_actions & (1 << k)))) continue;
                for (int i = 0; i < m; ++i) next[i] = reach[i] * node->current[i * a + k];
                if (!train(g, node->children[k], next, own_reach, value)) return 0;
                remap_add(out, value, 0, n);
            }
        } else {
            double *values = take(g, all_locked ? n : n * a);
            double *own_next = own_reach ? take(g, n) : (double *)0;
            if (!values || (own_reach && !own_next)) return 0;
            for (int k = 0; k < a; ++k) {
                if ((node->pruned && node->pruned[k]) ||
                    (all_locked && !(decision->locked_actions & (1 << k)))) continue;
                if (own_next) {
                    for (int i = 0; i < n; ++i) {
                        int row = i * a + k;
                        double p = node->current[row];
                        own_next[i] = own_reach[i] * p;
                        if (!is_locked(decision, i)) node->average[row] += g->average_weight * own_reach[i] * p;
                    }
                }
                double *action = all_locked ? values : values + n * k;
                if (!train(g, node->children[k], reach, own_next, action)) return 0;
                for (int i = 0; i < n; ++i) out[i] += node->current[i * a + k] * action[i];
            }
            if (!all_locked) {
                for (int i = 0; i < n; ++i) {
                    if (is_locked(decision, i) || (decision->suit_row && decision->suit_row[i] != i)) continue;
                    double *regret = node->regret + i * a;
                    double sum = 0;
                    for (int k = 0; k < a; ++k) {
                        if (node->pruned && node->pruned[k]) continue;
                        double delta = values[n * k + i] - out[i], next = regret[k] + delta;
                        if (g->variant == 1 || g->variant == 3)
                            regret[k] = next * (next > 0 ? g->positive_discount : g->negative_discount);
                        else regret[k] = next > 0 ? next : 0;
                        if (node->previous_delta) node->previous_delta[i * a + k] = delta;
                        if (regret[k] > 0) sum += regret[k];
                    }
                    if (g->fused) {
                        for (int k = 0; k < a; ++k)
                            node->current[i * a + k] = sum > g->tie_floor ? (regret[k] > 0 ? regret[k] / sum : 0) : 1.0 / a;
                    }
                }
                if (g->fused && decision->suit_row) {
                    for (int i = 0; i < n; ++i) {
                        int h = decision->suit_row[i];
                        if (i != h) {
                            for (int k = 0; k < a; ++k) node->current[i * a + k] = node->current[h * a + k];
                        }
                    }
                }
            }
        }
    }
    g->scratch = mark;
    return 1;
}

__attribute__((export_name("evaluate_gto")))
int evaluate_gto(const Node *nodes, const Decision *decisions, const Player *players, int id, int target,
    double pot, const double *reach, double *out, double *scratch, double *end, int profile, int unrestricted) {
    Game game = {.nodes=nodes, .decisions=decisions, .mine=players+target, .opponent=players+1-target,
        .target=target, .pot=pot, .scratch=scratch, .end=end, .profile=profile, .unrestricted=unrestricted};
    return evaluate(&game, id, reach, out);
}

__attribute__((export_name("train_locked")))
int train_locked(const Node *nodes, const Decision *decisions, const Player *players, int id, int target,
    double pot, const double *reach, double *out, double *own, double *scratch, double *end,
    double weight, int variant, double positive, double negative, int fused, double tie_floor) {
    Game game = {.nodes=nodes, .decisions=decisions, .mine=players+target, .opponent=players+1-target,
        .target=target, .pot=pot, .scratch=scratch, .end=end, .average_weight=weight, .variant=variant,
        .positive_discount=positive, .negative_discount=negative, .fused=fused, .tie_floor=tie_floor};
    if (own) {
        for (int i = 0; i < game.mine->length; ++i) own[i] = 1;
    }
    return train(&game, id, reach, own, out);
}
