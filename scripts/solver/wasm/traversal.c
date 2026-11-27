/* Heads-up GTO/DCFR traversal over PokerTools' packed tree and persistent rows. */
#include <stdint.h>
#include <stddef.h>

#if defined(__wasm_simd128__) && !defined(POKERTOOLS_AUTOVECTOR_ONLY)
#include <wasm_simd128.h>
#endif

#define CARDS 52
#define MAX_ACTIONS 11
#define EXPORT(name) __attribute__((export_name(name)))
#define INLINE static inline __attribute__((always_inline))

enum { TERMINAL, DECISION, CHANCE };
enum { TRAIN, PROFILE, BEST, CONSTRAINED };
enum { COMPACT=1, REGRET32=2, AVERAGE32=4, CURRENT32=8, SCALED_AVERAGE=16, ALIASES=32 };
typedef struct {
    const uint16_t *mine, *opp, *starts, *weak, *tie;
    int count;
} Payoff;
typedef struct {
    int child, card;
    const uint16_t *const *maps;
    int count;
    const double *weight;
} Deal;
typedef struct {
    int kind, actor, actions;
    const int *children;
    int deal_count;
    const Deal *deals;
    void *current, *regret, *average;
    int entropy, log;
    const uint8_t *valid[2];
    const Payoff *payoff[2];
    int winner, chips[2], turn, river, previous, pruned;
} Node;
typedef struct {
    int count;
    const uint8_t *card0, *card1;
    const int16_t *same;
} Player;
typedef struct {
    int flags;
    const int16_t *rows;
    const uint16_t *reps;
    const double *implicit;
    const uint8_t *locked;
    const double *fixed;
    const int16_t *fixed_rows;
    int shared_lock;
    int8_t *exponent;
} Strategy;
typedef struct {
    const Node *nodes;
    const Player *mine, *opp;
    const Strategy *strategies;
    double half_pot, regret_unit, tie_floor, averaging, positive, negative;
    int target, mode, conditioned, failed;
    double *end;
} Solver;

_Static_assert(sizeof(Node)==88 && sizeof(Deal)==20 && sizeof(Player)==16 &&
               sizeof(Payoff)==24 && sizeof(Strategy)==36, "WebAssembly bridge ABI");

typedef struct {
    const uint8_t *valid;
    double total, cards[CARDS];
    int ready;
} Basis;
typedef struct {
    const double *weights;
    Basis *basis;
} Reach;

static const Strategy *strategies;
static double regret_unit, tie_floor;

EXPORT("configure_strategy")
void configure_strategy(const Strategy *table, double unit, double floor) {
    strategies=table;
    regret_unit=unit;
    tie_floor=floor;
}

INLINE void clear(double *v, int n) {
    for(int i=0;i<n;i++) v[i]=0;
}
INLINE void add(double *to, const double *from, int n) {
    for(int i=0;i<n;i++) to[i]+=from[i];
}

static void deal_reach(const Player *p, const double *reach, double *out, int card, double weight) {
    int i=0;
#if defined(__wasm_simd128__) && !defined(POKERTOOLS_AUTOVECTOR_ONLY)
    const v128_t wanted=wasm_i8x16_splat((int8_t)card),w=wasm_f64x2_splat(weight);
    for(;i+4<=p->count;i+=4){
        const v128_t first=wasm_v128_load32_zero(p->card0+i),second=wasm_v128_load32_zero(p->card1+i);
        const v128_t mask=wasm_v128_or(wasm_i8x16_eq(first,wanted),wasm_i8x16_eq(second,wanted));
        const v128_t blocked=wasm_i32x4_extend_low_i16x8(wasm_i16x8_extend_low_i8x16(mask));
        const v128_t low=wasm_i64x2_extend_low_i32x4(blocked),high=wasm_i64x2_extend_high_i32x4(blocked);
        wasm_v128_store(out+i,wasm_v128_andnot(wasm_f64x2_mul(wasm_v128_load(reach+i),w),low));
        wasm_v128_store(out+i+2,wasm_v128_andnot(wasm_f64x2_mul(wasm_v128_load(reach+i+2),w),high));
    }
#endif
    for(;i<p->count;i++)out[i]=p->card0[i]!=card&&p->card1[i]!=card?reach[i]*weight:0;
}

// The basis belongs to one opponent reach generation. Reuse it across hero
// actions with the same public masks, and rebuild it after a deal or IP action.
static void build_basis(Basis *basis, const Player *p, const double *reach, const uint8_t *valid) {
    clear(basis->cards,CARDS);
    double total=0;
    for(int i=0;i<p->count;i++){
        if(valid&&!valid[i])continue;
        double w=reach[i];
        total+=w;
        basis->cards[p->card0[i]]+=w;
        basis->cards[p->card1[i]]+=w;
    }
    basis->total=total;
    basis->valid=valid;
    basis->ready=1;
}

static void terminal(const Solver *s, const Node *node, Reach reach, double *out) {
    const Player *mine=s->mine,*opp=s->opp;
    const uint8_t *valid=node->valid[s->target],*opp_valid=s->conditioned?NULL:node->valid[1-s->target];
    const double *weights=reach.weights;
    Basis *basis=reach.basis;
    if(!basis->ready||basis->valid!=opp_valid)build_basis(basis,opp,weights,opp_valid);
    const double total=basis->total,*mass=basis->cards;
    const double win=s->half_pot+node->chips[1-s->target],loss=-s->half_pot-node->chips[s->target];
    if(node->winner>=0){
        const double payoff=node->winner==s->target?win:loss;
        for(int i=0;i<mine->count;i++){
            const int j=mine->same[i];
            out[i]=valid&&!valid[i]?0:payoff*(total-mass[mine->card0[i]]-mass[mine->card1[i]]+(j<0?0:weights[j]));
        }
        return;
    }
    clear(out,mine->count);
    const Payoff *layout=node->payoff[s->target];
    const double tie=(node->chips[1-s->target]-node->chips[s->target])*0.5;
    double weaker[CARDS],equal[CARDS],weak_total=0;
    clear(weaker,CARDS);clear(equal,CARDS);
    int j=0;
    for(int g=0;g<layout->count;g++){
        const int weak_end=layout->weak[g],end=layout->tie[g];
        for(;j<weak_end;j++){
            const int oi=layout->opp[j];
            const double w=weights[oi];
            weak_total+=w;weaker[opp->card0[oi]]+=w;weaker[opp->card1[oi]]+=w;
        }
        double tie_total=0;
        for(int k=j;k<end;k++){
            const int oi=layout->opp[k];
            const double w=weights[oi];
            tie_total+=w;equal[opp->card0[oi]]+=w;equal[opp->card1[oi]]+=w;
        }
        for(int k=layout->starts[g];k<layout->starts[g+1];k++){
            const int mi=layout->mine[k],a=mine->card0[mi],b=mine->card1[mi],same=mine->same[mi];
            const double self=same<0?0:weights[same];
            const double compatible=total-mass[a]-mass[b]+self;
            const double weak=weak_total-weaker[a]-weaker[b],eq=tie_total-equal[a]-equal[b]+self;
            const double strong=compatible-weak-eq;
            out[mi]=weak*win+eq*tie+strong*loss;
        }
        for(;j<end;j++){
            const int oi=layout->opp[j],a=opp->card0[oi],b=opp->card1[oi];
            const double w=weights[oi];
            weak_total+=w;weaker[a]+=w;weaker[b]+=w;equal[a]=0;equal[b]=0;
        }
    }
}

INLINE int row_of(const Strategy *st, int hand) {
    return st->flags&COMPACT?(st->rows?st->rows[hand]:-1):hand;
}
INLINE int locked(const Strategy *st, int hand) {
    return st->locked&&st->locked[hand];
}
INLINE const double *lock_row(const Strategy *st, int hand, int actions) {
    const int row=st->shared_lock?0:st->fixed_rows?st->fixed_rows[hand]:hand;
    return st->fixed+row*actions;
}
INLINE double current(const Node *node, const Strategy *st, int off, int action) {
    if(!(st->flags&CURRENT32))return ((const double *)node->current)[off+action];
    const float *p=(const float *)node->current+off;
    if(p[action]>=0)return p[action];
    double sum=0;
    for(int k=0;k<node->actions;k++)if(k!=action)sum+=p[k];
    return 1-sum;
}
INLINE double average_at(const Node *node, const Strategy *st, int index) {
    return st->flags&AVERAGE32?((const float *)node->average)[index]:((const double *)node->average)[index];
}
INLINE double average_sum(const Node *node, const Strategy *st, int off) {
    double sum=0;
    for(int k=0;k<node->actions;k++)sum+=average_at(node,st,off+k);
    return sum;
}
INLINE double probability(const Node *node, const Strategy *st, int hand, int action, double sum) {
    if(locked(st,hand))return lock_row(st,hand,node->actions)[action];
    const int row=row_of(st,hand),off=row*node->actions;
    if(row<0)return st->implicit[action];
    return sum>0?average_at(node,st,off+action)/sum:current(node,st,off,action);
}

#if defined(__wasm_simd128__) && !defined(POKERTOOLS_AUTOVECTOR_ONLY)
INLINE v128_t action_zero(v128_t first,v128_t second) {
    return wasm_i64x2_shuffle(first,second,0,2);
}
INLINE v128_t action_one(v128_t first,v128_t second) {
    return wasm_i64x2_shuffle(first,second,1,3);
}
INLINE v128_t discounted(v128_t regret,v128_t values,v128_t ev,v128_t pos,v128_t neg,v128_t zero) {
    const v128_t sum=wasm_f64x2_add(regret,wasm_f64x2_sub(values,ev));
    return wasm_f64x2_mul(sum,wasm_v128_bitselect(pos,neg,wasm_f64x2_gt(sum,zero)));
}
#endif

// Binary dense decisions have no row mapping. Across two hands the action
// dot product, regret update and average each retain their scalar order.
static void train_binary(const Solver *s,const Node *node,const double *values,
                         const double *own,double *out) {
    const int n=s->mine->count;
    double *policy=node->current,*regret=node->regret,*average=node->average;
    const double *first=values,*second=values+n;
    int i=0;
#if defined(__wasm_simd128__) && !defined(POKERTOOLS_AUTOVECTOR_ONLY)
    const v128_t zero=wasm_f64x2_splat(0),half=wasm_f64x2_splat(0.5);
    const v128_t pos=wasm_f64x2_splat(s->positive),neg=wasm_f64x2_splat(s->negative);
    const v128_t floor=wasm_f64x2_splat(s->tie_floor),weight=wasm_f64x2_splat(s->averaging);
    for(;i+2<=n;i+=2){
        const int off=i*2;
        const v128_t p=wasm_v128_load(policy+off),q=wasm_v128_load(policy+off+2);
        const v128_t p0=action_zero(p,q),p1=action_one(p,q);
        const v128_t v0=wasm_v128_load(first+i),v1=wasm_v128_load(second+i);
        const v128_t ev=wasm_f64x2_add(wasm_f64x2_mul(p0,v0),wasm_f64x2_mul(p1,v1));
        wasm_v128_store(out+i,ev);
        const v128_t r=wasm_v128_load(regret+off),t=wasm_v128_load(regret+off+2);
        const v128_t r0=discounted(action_zero(r,t),v0,ev,pos,neg,zero);
        const v128_t r1=discounted(action_one(r,t),v1,ev,pos,neg,zero);
        wasm_v128_store(regret+off,action_zero(r0,r1));
        wasm_v128_store(regret+off+2,action_one(r0,r1));
        const v128_t positive0=wasm_f64x2_max(r0,zero),positive1=wasm_f64x2_max(r1,zero);
        const v128_t total=wasm_f64x2_add(positive0,positive1),has_regret=wasm_f64x2_gt(total,floor);
        const v128_t next0=wasm_v128_bitselect(wasm_f64x2_div(positive0,total),half,has_regret);
        const v128_t next1=wasm_v128_bitselect(wasm_f64x2_div(positive1,total),half,has_regret);
        wasm_v128_store(policy+off,action_zero(next0,next1));
        wasm_v128_store(policy+off+2,action_one(next0,next1));
        if(own){
            const v128_t w=wasm_f64x2_mul(weight,wasm_v128_load(own+i));
            const v128_t avg0=wasm_f64x2_mul(w,p0),avg1=wasm_f64x2_mul(w,p1);
            wasm_v128_store(average+off,wasm_f64x2_add(wasm_v128_load(average+off),action_zero(avg0,avg1)));
            wasm_v128_store(average+off+2,wasm_f64x2_add(wasm_v128_load(average+off+2),action_one(avg0,avg1)));
        }
    }
#endif
    for(;i<n;i++){
        const int off=i*2;
        const double p=policy[off],q=policy[off+1],x=first[i],y=second[i],ev=p*x+q*y;
        out[i]=ev;
        const double r=regret[off]+(x-ev),t=regret[off+1]+(y-ev);
        const double r0=r*(r>0?s->positive:s->negative),r1=t*(t>0?s->positive:s->negative);
        regret[off]=r0;regret[off+1]=r1;
        const double u=r0>0?r0:0,v=r1>0?r1:0,sum=u+v;
        policy[off]=sum>s->tie_floor?u/sum:0.5;
        policy[off+1]=sum>s->tie_floor?v/sum:0.5;
        if(own){const double w=s->averaging*own[i];average[off]+=w*p;average[off+1]+=w*q;}
    }
}

static void action_reach(const Node *node, const Strategy *st, const double *reach, double *out,
                         const double *sums, int count, int action) {
    if(!sums&&!st->flags&&!st->locked){
        const double *p=(const double *)node->current+action;
        const int actions=node->actions;
        if(actions==2){
            int i=0;
#if defined(__wasm_simd128__) && !defined(POKERTOOLS_AUTOVECTOR_ONLY)
            for(;i+2<count;i+=2){
                const v128_t r=wasm_v128_load(reach+i);
                const v128_t pair=wasm_f64x2_make(p[2*i],p[2*i+2]);
                wasm_v128_store(out+i,wasm_f64x2_mul(r,pair));
            }
#endif
            for(;i<count;i++)out[i]=reach[i]*p[i*2];
            return;
        }
        for(int i=0;i<count;i++)out[i]=reach[i]*p[i*actions];
        return;
    }
    for(int i=0;i<count;i++)out[i]=reach[i]*probability(node,st,i,action,sums?sums[i]:0);
}

INLINE double power_of_two(int e) {
    union { uint64_t bits; double value; } v;
    v.bits=e>1023?UINT64_C(0x7ff0000000000000):e<-1074?0:
           e<-1022?UINT64_C(1)<<(e+1074):(uint64_t)(e+1023)<<52;
    return v.value;
}
static void average_scaled(const Node *node, const Strategy *st, int row, int action, double increment) {
    if(!increment)return;
    const int a=node->actions;
    float *values=(float *)node->average+row*a;
    int bucket=st->exponent[row];
    double delta=increment*power_of_two(-64*bucket);
    const int headroom=values[action]+delta>0x1p64;
    if(headroom||(delta<0x1p-64&&!values[action])){
        union { double value; uint64_t bits; } v={.value=increment};
        const int bias=(int)((v.bits>>52)&2047);
        const int exponent=bias?bias-1023:-1011-__builtin_clzll(v.bits);
        int desired=(exponent<0?exponent-63:exponent)/64;
        if(headroom&&desired<=bucket)desired=bucket+1;
        if(desired<-15)desired=-15;
        if(desired>15)desired=15;
        int empty=desired<bucket;
        for(int k=0;empty&&k<a;k++)empty=values[k]==0;
        if(desired>bucket||empty){
            const double scale=power_of_two((bucket-desired)*64);
            for(int k=0;k<a;k++)if(values[k])values[k]=(float)(values[k]*scale);
            st->exponent[row]=(int8_t)desired;
            delta=increment*power_of_two(-64*desired);
        }
    }
    values[action]=(float)(values[action]+delta);
}

static void update_row(const Solver *s, const Node *node, const Strategy *st, int row,
                       const double *values, const double *policy, double ev, double weight) {
    const int a=node->actions,off=row*a;
    const int flags=st->flags;
    double r[MAX_ACTIONS],next[MAX_ACTIONS];
    int k=0;
#if defined(__wasm_simd128__) && !defined(POKERTOOLS_AUTOVECTOR_ONLY)
    const v128_t zero=wasm_f64x2_splat(0),baseline=wasm_f64x2_splat(ev);
    const v128_t scale=wasm_f64x2_splat(s->regret_unit);
    const v128_t pos=wasm_f64x2_splat(s->positive),neg=wasm_f64x2_splat(s->negative);
    for(;k+2<=a;k+=2){
        const v128_t past=flags&REGRET32?
            wasm_f64x2_promote_low_f32x4(wasm_v128_load64_zero((const float *)node->regret+off+k)):
            wasm_v128_load((const double *)node->regret+off+k);
        const v128_t diff=wasm_f64x2_mul(wasm_f64x2_sub(wasm_v128_load(values+k),baseline),scale);
        const v128_t sum=wasm_f64x2_add(past,diff);
        const v128_t rate=wasm_v128_bitselect(pos,neg,wasm_f64x2_gt(sum,zero));
        const v128_t updated=wasm_f64x2_mul(sum,rate);
        if(flags&REGRET32){
            const v128_t stored=wasm_f32x4_demote_f64x2_zero(updated);
            wasm_v128_store64_lane((float *)node->regret+off+k,stored,0);
            wasm_v128_store(r+k,wasm_f64x2_promote_low_f32x4(stored));
        }else{
            wasm_v128_store((double *)node->regret+off+k,updated);
            wasm_v128_store(r+k,updated);
        }
    }
#endif
    for(;k<a;k++){
        const double delta=(values[k]-ev)*s->regret_unit;
        if(flags&REGRET32){
            float *slot=(float *)node->regret+off+k;
            const double x=*slot+delta;
            *slot=(float)(x*(x>0?s->positive:s->negative));
            r[k]=*slot;
        }else{
            double *slot=(double *)node->regret+off+k;
            const double x=*slot+delta;
            *slot=x*(x>0?s->positive:s->negative);
            r[k]=*slot;
        }
    }
    double total=0;
    for(k=0;k<a;k++){r[k]=r[k]>0?r[k]:0;total+=r[k];}
    for(k=0;k<a;k++)next[k]=total>s->tie_floor?r[k]/total:1.0/a;
    if(flags&CURRENT32){
        int largest=0;
        for(k=1;k<a;k++)if(next[k]>next[largest])largest=k;
        for(k=0;k<a;k++)((float *)node->current)[off+k]=k==largest?-1.0f:(float)next[k];
    }else for(k=0;k<a;k++)((double *)node->current)[off+k]=next[k];
    if(weight==0)return;
    if(flags&SCALED_AVERAGE)for(k=0;k<a;k++)average_scaled(node,st,row,k,weight*policy[k]);
    else if(flags&AVERAGE32)for(k=0;k<a;k++){
        float *slot=(float *)node->average+off+k;
        *slot=(float)(*slot+weight*policy[k]);
    }else for(k=0;k<a;k++)((double *)node->average)[off+k]+=weight*policy[k];
}

static void visit(Solver *s, int id, Reach opp, const double *own, double *out, double *scratch) {
    if(s->failed)return;
    const Node *node=s->nodes+id;
    const int n=s->mine->count,on=s->opp->count,a=node->actions;
    if(node->kind==TERMINAL){terminal(s,node,opp,out);return;}
    if(node->kind==CHANCE){
        double *next=scratch,*value=next+on,*next_own=own?value+n:NULL,*end=value+n+(own?n:0);
        if(end>s->end){s->failed=1;return;}
        Basis basis;
        clear(out,n);
        for(int j=0;j<node->deal_count;j++){
            const Deal *deal=node->deals+j;
            const double w=*deal->weight;
            deal_reach(s->opp,opp.weights,next,deal->card,w);
            if(own)deal_reach(s->mine,own,next_own,deal->card,w);
            basis.ready=0;
            visit(s,deal->child,(Reach){next,&basis},next_own,value,end);
            if(s->failed)return;
            for(int k=0;k<deal->count;k++){
                const uint16_t *map=deal->maps[k*2+s->target];
                if(map)for(int h=0;h<n;h++)out[map[h]]+=value[h];
                else add(out,value,n);
            }
        }
        return;
    }
    const Strategy *st=s->strategies+id;
    if(a==1){
        if(own&&node->actor==s->target&&!(st->flags&COMPACT))
            for(int h=0;h<n;h++){
                const double weight=s->averaging*own[h];
                if(st->flags&SCALED_AVERAGE)average_scaled(node,st,h,0,weight);
                else if(st->flags&AVERAGE32)((float *)node->average)[h]=(float)(((float *)node->average)[h]+weight);
                else ((double *)node->average)[h]+=weight;
            }
        visit(s,node->children[0],opp,own,out,scratch);
        return;
    }
    if(node->actor!=s->target){
        double *next=scratch,*value=next+on,*sums=s->mode==TRAIN?NULL:value+n,*end=value+n+(sums?on:0);
        if(end>s->end){s->failed=1;return;}
        if(sums)for(int h=0;h<on;h++){
            const int row=row_of(st,h);
            sums[h]=row<0||locked(st,h)?0:average_sum(node,st,row*a);
        }
        Basis basis;
        clear(out,n);
        for(int k=0;k<a;k++){
            action_reach(node,st,opp.weights,next,sums,on,k);
            basis.ready=0;
            visit(s,node->children[k],(Reach){next,&basis},own,value,end);
            if(s->failed)return;
            add(out,value,n);
        }
        return;
    }
    double *values=scratch,*next=own?values+n*a:NULL,*end=values+n*a+(own?n:0);
    if(end>s->end){s->failed=1;return;}
    for(int k=0;k<a;k++){
        if(own)action_reach(node,st,own,next,NULL,n,k);
        visit(s,node->children[k],opp,next,values+k*n,end);
        if(s->failed)return;
    }
    if(s->mode==TRAIN&&a==2&&!st->flags&&!st->locked){
        train_binary(s,node,values,own,out);
        return;
    }
    if(a==2&&(s->mode==BEST||(s->mode==CONSTRAINED&&!st->locked))){
        for(int h=0;h<n;h++)out[h]=values[h+n]>values[h]?values[h+n]:values[h];
        return;
    }
    const int aliased=s->mode==TRAIN&&(st->flags&ALIASES);
    // Representatives and their aliases must all see the same pre-update
    // policy. Compute their CFVs before any representative's row is changed.
    if(aliased)for(int h=0;h<n;h++){
        double ev=0;
        for(int k=0;k<a;k++)ev+=probability(node,st,h,k,0)*values[k*n+h];
        out[h]=ev;
    }
    for(int h=0;h<n;h++){
        const int row=row_of(st,h),fixed=locked(st,h),off=row*a;
        if(aliased&&(fixed||row<0||st->reps[row]!=h))continue;
        if(s->mode==BEST||(s->mode==CONSTRAINED&&!fixed)){
            double best=values[h];
            for(int k=1;k<a;k++)if(values[k*n+h]>best)best=values[k*n+h];
            out[h]=best;
            continue;
        }
        const double sum=s->mode==TRAIN||row<0||fixed?0:average_sum(node,st,off);
        double ev=0,policy[MAX_ACTIONS],v[MAX_ACTIONS];
        for(int k=0;k<a;k++){
            policy[k]=probability(node,st,h,k,sum);
            v[k]=values[k*n+h];
            ev+=policy[k]*v[k];
        }
        out[h]=ev;
        if(s->mode==TRAIN&&!fixed&&row>=0&&(!(st->flags&COMPACT)||st->reps[row]==h))
            update_row(s,node,st,row,v,policy,ev,own?s->averaging*own[h]:0);
    }
}

static int run(const Node *nodes, const Player *players, int id, int target, int mode,
               double pot, double averaging, const double *reach, double *out,
               double *own, double *scratch, double *end, double positive, double negative) {
    // Root priors already exclude the starting board. The chance path keeps
    // them conditioned, while selected subtrees can receive an arbitrary reach.
    Solver solver={nodes,players+target,players+1-target,strategies,pot*0.5,regret_unit,tie_floor,
                   averaging,positive,negative,target,mode,id==0,0,end};
    if(own)for(int i=0;i<solver.mine->count;i++)own[i]=1;
    Basis basis;
    basis.ready=0;
    visit(&solver,id,(Reach){reach,&basis},own,out,scratch);
    return !solver.failed;
}

EXPORT("full_traverse")
int full_traverse(const Node *nodes, const Player *players, int id, int target, int qre,
                  double temperature, double pot, double averaging, const double *reach,
                  double *out, double *own, double *scratch, double *end,
                  int algorithm, double positive, double negative) {
    (void)qre;(void)temperature;(void)algorithm;
    return run(nodes,players,id,target,TRAIN,pot,averaging,reach,out,own,scratch,end,positive,negative);
}
EXPORT("exact_best_response")
int exact_best_response(const Node *nodes, const Player *players, int id, int target, int constrained,
                        double temperature, double pot, const double *reach, double *out,
                        double *scratch, double *end) {
    (void)temperature;
    return run(nodes,players,id,target,constrained?CONSTRAINED:BEST,pot,0,reach,out,NULL,scratch,end,0,0);
}
EXPORT("profile_evaluate")
int profile_evaluate(const Node *nodes, const Player *players, int id, int target, double pot,
                     const double *reach, double *out, double *scratch, double *end) {
    return run(nodes,players,id,target,PROFILE,pot,0,reach,out,NULL,scratch,end,0,0);
}
EXPORT("kernel_features")
int kernel_features(void) {
#ifdef __wasm_simd128__
    return 1;
#else
    return 0;
#endif
}
