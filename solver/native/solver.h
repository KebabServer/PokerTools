#ifndef TURN_RIVER_SOLVER_H
#define TURN_RIVER_SOLVER_H

/* Arena offsets are unsigned 32-bit byte offsets. Data are trusted, aligned
 * and packed by the TurnRiverLab bridge. The native host owns the arena. */
int evaluate_gto(void *arena, unsigned nodes, unsigned decisions, unsigned players, int root, int target,
    double pot, unsigned reach, unsigned out, unsigned scratch, unsigned end, int profile, int unrestricted,
    int precision, double tie_floor);
int train_locked(void *arena, unsigned nodes, unsigned decisions, unsigned players, int root, int target,
    double pot, unsigned reach, unsigned out, unsigned own, unsigned scratch, unsigned end, double weight,
    int variant, double positive, double negative, int fused, double tie_floor, int precision);

#endif
