/*
 * Float64 GTO traversal and EV-only evaluation for TurnRiverLab.
 * This source-backed module shares the typed game metadata and numerical state
 * packed by compiled-traversal.js. It has no static or imported mutable state.
 */
typedef unsigned char u8;
typedef unsigned short u16;
typedef short i16;
typedef unsigned int Offset;

typedef struct {
    int length;
    Offset card0, card1, opponent_index;
} Player;

typedef struct {
    Offset mine, opponent, start, weak_end, tie_end;
    int group_count;
} Payoff;

typedef struct {
    int child, card;
    Offset maps;  /* two map offsets per member, zero means identity */
    int size;
    Offset weight;
} ChanceGroup;

typedef struct {
    int kind, actor, actions;
    Offset children;
    int group_count;
    Offset groups;
    Offset current, regret, average, regret_scale, average_scale;
    Offset valid[2], payoff[2];
    int fold_winner, committed[2], turn, river;
    Offset previous_delta, pruned;
} Node;

typedef struct {
    Offset locked, suit_row;
    int locked_actions;  /* -1 if any row is free; otherwise a bit mask */
    int frequency_units;
    Offset rows, representatives;
    int row_count;
    Offset fixed;
} Decision;

typedef struct {
    __UINTPTR_TYPE__ base;
    const Node *nodes;
    const Decision *decisions;
    const Player *mine, *opponent;
    const u8 *mine0, *mine1, *opp0, *opp1;
    const i16 *opponent_index;
    int target;
    double pot;
    double *scratch, *end;
    double average_weight, positive_discount, negative_discount, tie_floor;
    int variant, fused, profile, unrestricted, precision;
} Game;

_Static_assert(sizeof(Node) == 22 * 4, "Node table ABI");
_Static_assert(sizeof(ChanceGroup) == 5 * 4, "Chance table ABI");
_Static_assert(sizeof(Decision) == 8 * 4, "Decision table ABI");
_Static_assert(sizeof(Payoff) == 6 * 4 && sizeof(Player) == 4 * 4, "Payoff table ABI");

#define SLOT(game, type, offset) ((type *)((game)->base + (offset)))
#define AT(type, offset) SLOT(g, type, offset)
#define MAYBE(type, offset) ((offset) ? AT(type, offset) : (type *)0)

static double *take(Game *g, int count) {
    if (g->end - g->scratch < count) return (double *)0;
    double *start = g->scratch;
    g->scratch += count;
    return start;
}

static int allows(const u8 *first, const u8 *second, int i, int card) {
    return first[i] != card && second[i] != card;
}

static int disjoint(const Game *g, int j, int a, int b) {
    return allows(g->opp0, g->opp1, j, a) && allows(g->opp0, g->opp1, j, b);
}

static void zero(double *values, int count) {
    for (int i = 0; i < count; ++i) values[i] = 0;
}

static void pair_equity(const Game *g, const Node *node, const double *reach, double *out) {
    const i16 *counts = AT(const i16, node->payoff[0]);
    int n = g->mine->length, m = g->opponent->length;
    double scale = (g->pot / 2 + node->committed[1]) / node->group_count;
    if (g->target == 0) {
        for (int i = 0; i < n; ++i) {
            double sum = 0;
            for (int j = 0; j < m; ++j) sum += counts[i * m + j] * reach[j];
            out[i] = sum * scale;
        }
    } else {
        zero(out, n);
        for (int j = 0; j < m; ++j) {
            if (reach[j] == 0) continue;
            for (int i = 0; i < n; ++i) out[i] -= counts[j * n + i] * reach[j];
        }
        for (int i = 0; i < n; ++i) out[i] *= scale;
    }
}

static void terminal(const Game *g, const Node *node, const double *reach, double *out) {
    const Player *mine = g->mine, *opponent = g->opponent;
    const u8 *mine_valid = MAYBE(const u8, node->valid[g->target]);
    const u8 *opp_valid = MAYBE(const u8, node->valid[1 - g->target]);
    double cards[52] = {0};
    double total = 0;
    int live = 0, last = -1;
    zero(out, mine->length);
    for (int i = 0; i < opponent->length; ++i) {
        if (opp_valid && !opp_valid[i]) continue;
        double w = reach[i];
        if (w == 0) continue;
        ++live;
        last = i;
        total += w;
        cards[g->opp0[i]] += w;
        cards[g->opp1[i]] += w;
    }
    if (!live) return;
    double win = g->pot / 2 + node->committed[1 - g->target];
    double loss = -g->pot / 2 - node->committed[g->target];
    if (node->fold_winner != -1) {
        double value = node->fold_winner == g->target ? win : loss;
        for (int i = 0; i < mine->length; ++i) {
            if (mine_valid && !mine_valid[i]) continue;
            int a = g->mine0[i], b = g->mine1[i], same = g->opponent_index[i];
            if (live == 1) {
                if (disjoint(g, last, a, b)) out[i] = value * reach[last];
                continue;
            }
            double mass = total - cards[a] - cards[b] + (same < 0 ? 0 : reach[same]);
            if (mass < total * 1e-12) {
                mass = 0;
                for (int j = 0; j < opponent->length; ++j) {
                    if ((!opp_valid || opp_valid[j]) && disjoint(g, j, a, b)) mass += reach[j];
                }
            }
            out[i] = value * mass;
        }
        return;
    }
    const Payoff *layout = AT(const Payoff, node->payoff[g->target]);
    const u16 *mine_order = AT(const u16, layout->mine), *opp_order = AT(const u16, layout->opponent);
    const u16 *start = AT(const u16, layout->start), *weak_ends = AT(const u16, layout->weak_end);
    const u16 *tie_ends = AT(const u16, layout->tie_end);
    double weaker_cards[52] = {0}, tied_cards[52] = {0};
    double weaker_total = 0;
    double tie = (node->committed[1 - g->target] - node->committed[g->target]) / 2.0;
    if (live == 1) {
        // A single live hand has an exact rank position in the opponent list.
        // Find it once and avoid subtracting nearly identical blocker masses.
        int position = 0;
        while (opp_order[position] != last) ++position;
        for (int group = 0; group < layout->group_count; ++group) {
            double value = reach[last] * (position < weak_ends[group] ? win : position < tie_ends[group] ? tie : loss);
            for (int pos = start[group]; pos < start[group + 1]; ++pos) {
                int i = mine_order[pos];
                if (disjoint(g, last, g->mine0[i], g->mine1[i])) out[i] = value;
            }
        }
        return;
    }
    int cursor = 0;
    for (int group = 0; group < layout->group_count; ++group) {
        int weak_end = weak_ends[group], tie_end = tie_ends[group];
        while (cursor < weak_end) {
            int j = opp_order[cursor++];
            double w = reach[j];
            weaker_total += w;
            weaker_cards[g->opp0[j]] += w;
            weaker_cards[g->opp1[j]] += w;
        }
        double tied_total = 0;
        for (int pos = weak_end; pos < tie_end; ++pos) {
            int j = opp_order[pos];
            double w = reach[j];
            tied_total += w;
            tied_cards[g->opp0[j]] += w;
            tied_cards[g->opp1[j]] += w;
        }
        for (int pos = start[group]; pos < start[group + 1]; ++pos) {
            int i = mine_order[pos], a = g->mine0[i], b = g->mine1[i], same = g->opponent_index[i];
            double duplicate = same < 0 ? 0 : reach[same];
            double mass = total - cards[a] - cards[b] + duplicate;
            if (mass < total * 1e-12) {
                double value = 0;
                for (int j = 0; j < opponent->length; ++j) {
                    if ((!opp_valid || opp_valid[j]) && disjoint(g, j, a, b)) {
                        // Recover the opponent's rank relative to this bucket only for the rare
                        // cancellation case. The legal sorted list has every available hand.
                        value += reach[j];
                    }
                }
                double weak = 0, tied = 0;
                for (int k = 0; k < tie_end; ++k) {
                    int j = opp_order[k];
                    if (disjoint(g, j, a, b)) {
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
            int j = opp_order[cursor++];
            double w = reach[j];
            int a = g->opp0[j], b = g->opp1[j];
            weaker_total += w;
            weaker_cards[a] += w;
            weaker_cards[b] += w;
            tied_cards[a] = tied_cards[b] = 0;
        }
    }
}

static int is_locked(const Game *g, const Decision *decision, int hand) {
    return decision->locked && AT(const u8, decision->locked)[hand];
}

static double read_value(const Game *g, Offset offset, int i, int flag) {
    if (g->precision & flag) return AT(const float, offset)[i];
    return AT(const double, offset)[i];
}

static void write_value(const Game *g, Offset offset, int i, int flag, double value) {
    if (g->precision & flag) AT(float, offset)[i] = (float)value;
    else AT(double, offset)[i] = value;
}

static double read_accumulator(const Game *g, Offset offset, Offset scales, int i, int actions, int flag) {
    if (g->precision & 8)
        return (double)AT(const i16, offset)[i] * AT(const float, scales)[i / actions] / 32767.0;
    return read_value(g, offset, i, flag);
}

static void write_scaled(const Game *g, Offset offset, Offset scales, int row, int actions, const double *values) {
    double peak = 0;
    for (int k = 0; k < actions; ++k) {
        double value = values[k] < 0 ? -values[k] : values[k];
        if (value > peak) peak = value;
    }
    const double max_float = 0x1.fffffep127;
    float scale = (float)(peak > max_float ? max_float : peak);
    AT(float, scales)[row] = scale;
    for (int k = 0; k < actions; ++k) {
        double ratio = scale ? values[k] * 32767.0 / scale : 0;
        int rounded = ratio >= 32767 ? 32767 : ratio <= -32767 ? -32767 : (int)(ratio + (ratio < 0 ? -0.5 : 0.5));
        AT(i16, offset)[row * actions + k] = (i16)rounded;
    }
}

static void compact_policy(const Game *g, const Node *node, const Decision *decision, int n,
    double *policy, int average, int action_major) {
    const i16 *rows = AT(const i16, decision->rows);
    const double *fixed = MAYBE(const double, decision->fixed);
    int a = node->actions;
    for (int i = 0; i < n; ++i) {
        int stride = action_major ? n : 1;
        double *row = policy + (action_major ? i : i * a);
        int h = rows[i], off = h * a;
        if (h < 0) {
            for (int k = 0; k < a; ++k) row[k * stride] = h == -1 ? 1.0 / a : fixed[(-h - 2) * a + k];
            continue;
        }
        double sum = 0;
        if (average) {
            for (int k = 0; k < a; ++k)
                sum += read_accumulator(g, node->average, node->average_scale, off + k, a, 2);
        }
        if (sum > 0) {
            for (int k = 0; k < a; ++k)
                row[k * stride] = read_accumulator(g, node->average, node->average_scale, off + k, a, 2) / sum;
        } else if (g->precision & 16) {
            const double *regrets = AT(const double, node->regret) + off;
            for (int k = 0; k < a; ++k) if (regrets[k] > 0) sum += regrets[k];
            for (int k = 0; k < a; ++k)
                row[k * stride] = sum > g->tie_floor ? (regrets[k] > 0 ? regrets[k] / sum : 0) : 1.0 / a;
        } else if (g->precision & 4) {
            for (int k = 0; k < a; ++k) sum += AT(const float, node->current)[off + k];
            for (int k = 0; k < a; ++k) row[k * stride] = sum > 0 ? AT(const float, node->current)[off + k] / sum : 1.0 / a;
        } else {
            for (int k = 0; k < a; ++k) row[k * stride] = AT(const double, node->current)[off + k];
        }
    }
}

static void average_policy(const Game *g, const Node *node, const Decision *decision, int n, double *policy) {
    if (decision->rows) compact_policy(g, node, decision, n, policy, 1, 0);
    int a = node->actions, units = decision->frequency_units;
    if (decision->rows && !units) return;
    for (int i = 0; i < n; ++i) {
        int h = decision->suit_row ? AT(const u16, decision->suit_row)[i] : i;
        double *row = policy + i * a;
        double sum = 0;
        int fixed = is_locked(g, decision, h);
        if (!decision->rows) {
            const double *current = AT(const double, node->current) + h * a;
            const double *average = AT(const double, node->average) + h * a;
            if (!fixed) {
                for (int k = 0; k < a; ++k) {
                    if (!node->pruned || !AT(const u8, node->pruned)[k]) sum += average[k];
                }
            }
            for (int k = 0; k < a; ++k) {
                row[k] = node->pruned && AT(const u8, node->pruned)[k] ? 0 : sum > 0 ? average[k] / sum : current[k];
            }
        }
        if (!units || fixed || (decision->rows && AT(const i16, decision->rows)[i] < 0)) continue;
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

static void remap_add(double *restrict out, const double *restrict value, const u16 *map, int n) {
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
    if (node->kind == 0 || node->kind == 3) {
        if (node->kind == 0) terminal(g, node, reach, out);
        else pair_equity(g, node, reach, out);
        for (int v = 1; v < vectors; ++v) {
            for (int i = 0; i < n; ++i) out[v * n + i] = out[i];
        }
        return 1;
    }
    if (node->kind == 1 && node->actions == 1) return evaluate(g, AT(const int, node->children)[0], reach, out);

    double *mark = g->scratch;
    double *value = take(g, n * vectors), *next = take(g, m);
    if (!value || !next) return 0;
    zero(out, n * vectors);
    if (node->kind == 2) {
        for (int k = 0; k < node->group_count; ++k) {
            const ChanceGroup *group = AT(const ChanceGroup, node->groups) + k;
            for (int i = 0; i < m; ++i)
                next[i] = allows(g->opp0, g->opp1, i, group->card) ? reach[i] * *AT(const double, group->weight) : 0;
            if (!evaluate(g, group->child, next, value)) return 0;
            for (int j = 0; j < group->size; ++j) {
                const u16 *map = MAYBE(const u16, AT(const Offset, group->maps)[2 * j + g->target]);
                for (int v = 0; v < vectors; ++v) remap_add(out + v * n, value + v * n, map, n);
            }
        }
    } else {
        int a = node->actions, own = node->actor == g->target;
        double *policy = 0;
        if (!own || g->profile || decision->locked) {
            policy = take(g, a * (own ? n : m));
            if (!policy) return 0;
            average_policy(g, node, decision, own ? n : m, policy);
        }
        if (!own) {
            for (int k = 0; k < a; ++k) {
                if (node->pruned && AT(const u8, node->pruned)[k]) continue;
                if (decision->locked_actions != -1 && !(decision->locked_actions & (1 << k))) continue;
                int any = 0;
                for (int i = 0; i < m; ++i) {
                    next[i] = reach[i] * policy[i * a + k];
                    any |= next[i] != 0;
                }
                if (!any) continue;
                if (!evaluate(g, AT(const int, node->children)[k], next, value)) return 0;
                for (int i = 0; i < n * vectors; ++i) out[i] += value[i];
            }
        } else {
            int all_locked = decision->locked_actions != -1;
            double *unrestricted = out + n * (1 + g->profile);
            for (int k = 0; k < a; ++k) {
                // A current/pruned zero is still a legal deviation. Skip
                // only actions forbidden for all evaluated locked hands.
                if (!g->unrestricted && all_locked && !(decision->locked_actions & (1 << k))) continue;
                if (!evaluate(g, AT(const int, node->children)[k], reach, value)) return 0;
                for (int i = 0; i < n; ++i) {
                    double p = policy ? policy[i * a + k] : 0;
                    if (all_locked || is_locked(g, decision, i)) out[i] += p * value[i];
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
    if (node->kind == 0 || node->kind == 3) {
        if (node->kind == 0) terminal(g, node, reach, out);
        else pair_equity(g, node, reach, out);
        return 1;
    }
    if (node->kind == 1 && node->actions == 1) return train(g, AT(const int, node->children)[0], reach, own_reach, out);

    double *mark = g->scratch;
    zero(out, n);
    if (node->kind == 2) {
        double *value = take(g, n), *next = take(g, m);
        double *own_next = own_reach ? take(g, n) : (double *)0;
        if (!value || !next || (own_reach && !own_next)) return 0;
        for (int k = 0; k < node->group_count; ++k) {
            const ChanceGroup *group = AT(const ChanceGroup, node->groups) + k;
            double weight = *AT(const double, group->weight);
            for (int i = 0; i < m; ++i)
                next[i] = allows(g->opp0, g->opp1, i, group->card) ? reach[i] * weight : 0;
            if (own_next) {
                for (int i = 0; i < n; ++i)
                    own_next[i] = allows(g->mine0, g->mine1, i, group->card) ? own_reach[i] * weight : 0;
            }
            if (!train(g, group->child, next, own_next, value)) return 0;
            for (int j = 0; j < group->size; ++j)
                remap_add(out, value, MAYBE(const u16, AT(const Offset, group->maps)[2 * j + g->target]), n);
        }
    } else {
        int a = node->actions, all_locked = decision->locked_actions != -1;
        int own = node->actor == g->target, actor_hands = own ? n : m;
        const double *current = AT(const double, node->current);
        const u16 *reps = MAYBE(const u16, decision->representatives);
        int row_count = reps ? decision->row_count : n;
        int hand_stride = a, action_stride = 1;
        if (decision->rows) {
            double *policy = take(g, actor_hands * a);
            if (!policy) return 0;
            compact_policy(g, node, decision, actor_hands, policy, 0, 1);
            current = policy;
            hand_stride = 1;
            action_stride = actor_hands;
        }
        if (!own) {
            double *value = take(g, n), *next = take(g, m);
            if (!value || !next) return 0;
            for (int k = 0; k < a; ++k) {
                if ((node->pruned && AT(const u8, node->pruned)[k]) ||
                    (all_locked && !(decision->locked_actions & (1 << k)))) continue;
                const double *probability = current + k * action_stride;
                for (int i = 0; i < m; ++i) next[i] = reach[i] * probability[i * hand_stride];
                if (!train(g, AT(const int, node->children)[k], next, own_reach, value)) return 0;
                remap_add(out, value, 0, n);
            }
        } else {
            double *values = take(g, all_locked ? n : n * a);
            double *own_next = own_reach ? take(g, n) : (double *)0;
            if (!values || (own_reach && !own_next)) return 0;
            int scaled = g->precision & 8;
            if (own_reach && scaled) for (int h = 0; h < row_count; ++h) {
                double updates[12];
                int i = reps[h];
                for (int k = 0; k < a; ++k) {
                    updates[k] = read_accumulator(g, node->average, node->average_scale, h * a + k, a, 2) +
                        g->average_weight * own_reach[i] * current[k * action_stride + i * hand_stride];
                }
                write_scaled(g, node->average, node->average_scale, h, a, updates);
            }
            for (int k = 0; k < a; ++k) {
                if ((node->pruned && AT(const u8, node->pruned)[k]) ||
                    (all_locked && !(decision->locked_actions & (1 << k)))) continue;
                const double *probability = current + k * action_stride;
                if (own_next) {
                    for (int i = 0; i < n; ++i) {
                        own_next[i] = own_reach[i] * probability[i * hand_stride];
                    }
                    if (!scaled) for (int h = 0; h < row_count; ++h) {
                        int i = reps ? reps[h] : h;
                        if (is_locked(g, decision, i)) continue;
                        int index = h * a + k;
                        double sum = read_value(g, node->average, index, 2);
                        write_value(g, node->average, index, 2, sum + g->average_weight * own_reach[i] * probability[i * hand_stride]);
                    }
                }
                double *action = all_locked ? values : values + n * k;
                if (!train(g, AT(const int, node->children)[k], reach, own_next, action)) return 0;
                for (int i = 0; i < n; ++i) out[i] += probability[i * hand_stride] * action[i];
            }
            if (!all_locked) {
                for (int h = 0; h < row_count; ++h) {
                    int i = reps ? reps[h] : h;
                    if (is_locked(g, decision, i) ||
                        (!reps && decision->suit_row && AT(const u16, decision->suit_row)[i] != i)) continue;
                    double sum = 0;
                    double updates[12];
                    for (int k = 0; k < a; ++k) {
                        if (node->pruned && AT(const u8, node->pruned)[k]) continue;
                        int index = h * a + k;
                        double delta = values[n * k + i] - out[i];
                        double next = read_accumulator(g, node->regret, node->regret_scale, index, a, 1) + delta;
                        if (g->variant == 1 || g->variant == 3)
                            next *= next > 0 ? g->positive_discount : g->negative_discount;
                        else next = next > 0 ? next : 0;
                        if (scaled) updates[k] = next;
                        else write_value(g, node->regret, index, 1, next);
                        if (node->previous_delta) AT(double, node->previous_delta)[index] = delta;
                        if (g->precision & 1) next = (double)(float)next;
                        if (next > 0) sum += next;
                    }
                    if (scaled) {
                        write_scaled(g, node->regret, node->regret_scale, h, a, updates);
                        sum = 0;
                        for (int k = 0; k < a; ++k) {
                            double value = read_accumulator(g, node->regret, node->regret_scale, h * a + k, a, 1);
                            if (value > 0) sum += value;
                        }
                    }
                    if (g->fused) {
                        for (int k = 0; k < a; ++k) {
                            int index = h * a + k;
                            double regret = read_accumulator(g, node->regret, node->regret_scale, index, a, 1);
                            write_value(g, node->current, index, 4,
                                sum > g->tie_floor ? (regret > 0 ? regret / sum : 0) : 1.0 / a);
                        }
                    }
                }
                if (g->fused && !decision->rows && decision->suit_row) {
                    for (int i = 0; i < n; ++i) {
                        int h = AT(const u16, decision->suit_row)[i];
                        if (i != h) {
                            for (int k = 0; k < a; ++k) AT(double, node->current)[i * a + k] = current[h * a + k];
                        }
                    }
                }
            }
        }
    }
    g->scratch = mark;
    return 1;
}

static Game init_game(__UINTPTR_TYPE__ base, Offset nodes, Offset decisions, Offset players, int target,
    double pot, Offset scratch, Offset end, int precision) {
    Game game = {.base=base, .target=target, .pot=pot, .precision=precision};
    game.nodes = SLOT(&game, const Node, nodes);
    game.decisions = SLOT(&game, const Decision, decisions);
    const Player *pair = SLOT(&game, const Player, players);
    game.mine = pair + target;
    game.opponent = pair + 1 - target;
    game.mine0 = SLOT(&game, const u8, game.mine->card0);
    game.mine1 = SLOT(&game, const u8, game.mine->card1);
    game.opp0 = SLOT(&game, const u8, game.opponent->card0);
    game.opp1 = SLOT(&game, const u8, game.opponent->card1);
    game.opponent_index = SLOT(&game, const i16, game.mine->opponent_index);
    game.scratch = SLOT(&game, double, scratch);
    game.end = SLOT(&game, double, end);
    return game;
}

#ifdef __wasm__
#define ENTRY(name) __attribute__((export_name(#name))) int name(
#define ARENA
#define BASE 0
#else
#define ENTRY(name) int name(
#define ARENA void *arena,
#define BASE (__UINTPTR_TYPE__)arena
#endif

ENTRY(evaluate_gto) ARENA Offset nodes, Offset decisions, Offset players, int id, int target,
    double pot, Offset reach, Offset out, Offset scratch, Offset end, int profile, int unrestricted,
    int precision, double tie_floor) {
    Game game = init_game(BASE, nodes, decisions, players, target, pot, scratch, end, precision);
    game.profile = profile;
    game.unrestricted = unrestricted;
    game.tie_floor = tie_floor;
    return evaluate(&game, id, SLOT(&game, const double, reach), SLOT(&game, double, out));
}

ENTRY(train_locked) ARENA Offset nodes, Offset decisions, Offset players, int id, int target,
    double pot, Offset reach, Offset out, Offset own, Offset scratch, Offset end,
    double weight, int variant, double positive, double negative, int fused, double tie_floor, int precision) {
    Game game = init_game(BASE, nodes, decisions, players, target, pot, scratch, end, precision);
    game.average_weight = weight;
    game.variant = variant;
    game.positive_discount = positive;
    game.negative_discount = negative;
    game.fused = fused;
    game.tie_floor = tie_floor;
    double *own_reach = own ? SLOT(&game, double, own) : (double *)0;
    if (own_reach) {
        for (int i = 0; i < game.mine->length; ++i) own_reach[i] = 1;
    }
    return train(&game, id, SLOT(&game, const double, reach), own_reach, SLOT(&game, double, out));
}
