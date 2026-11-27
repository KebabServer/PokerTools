;; Compact CFR+/DCFR decision update. All strategy state is f64.
;; Map physical hands to compact ordinals, using -1 for an implicit row.
;; Action vectors and results use physical hand order.
(module
  (import "env" "memory" (memory 1))
  (func (export "update")
    (param $n i32) (param $actions i32) (param $map i32) (param $reps i32)
    (param $policy i32) (param $regret i32) (param $implicit i32)
    (param $values i32) (param $output i32)
    (param $dcfr i32) (param $positive f64) (param $negative f64)
    (local $h i32) (local $k i32) (local $row i32) (local $policyRow i32)
    (local $regretRow i32) (local $offset i32) (local $address i32)
    (local $v f64) (local $x f64)
    (block $finished
      (loop $hand
        (br_if $finished (i32.ge_u (local.get $h) (local.get $n)))
        (local.set $row (i32.load16_s (i32.add (local.get $map) (i32.shl (local.get $h) (i32.const 1)))))
        (local.set $offset (i32.shl (i32.mul (local.get $row) (local.get $actions)) (i32.const 3)))
        (local.set $policyRow
          (select (local.get $implicit) (i32.add (local.get $policy) (local.get $offset))
            (i32.lt_s (local.get $row) (i32.const 0))))
        (local.set $v (f64.const 0))
        (local.set $k (i32.const 0))
        (loop $mix
          (local.set $v (f64.add (local.get $v) (f64.mul
            (f64.load (i32.add (local.get $policyRow) (i32.shl (local.get $k) (i32.const 3))))
            (call $value (local.get $values) (local.get $k) (local.get $h)))))
          (local.set $k (i32.add (local.get $k) (i32.const 1)))
          (br_if $mix (i32.lt_u (local.get $k) (local.get $actions))))
        (f64.store (i32.add (local.get $output) (i32.shl (local.get $h) (i32.const 3))) (local.get $v))
        (block $skip
          (br_if $skip (i32.lt_s (local.get $row) (i32.const 0)))
          (br_if $skip (i32.ne (local.get $h)
            (i32.load16_u (i32.add (local.get $reps) (i32.shl (local.get $row) (i32.const 1))))))
          (local.set $regretRow (i32.add (local.get $regret) (local.get $offset)))
          (local.set $k (i32.const 0))
          (loop $update
            (local.set $address (i32.add (local.get $regretRow) (i32.shl (local.get $k) (i32.const 3))))
            (local.set $x (f64.add (f64.load (local.get $address))
              (f64.sub (call $value (local.get $values) (local.get $k) (local.get $h)) (local.get $v))))
            (f64.store (local.get $address)
              (if (result f64) (local.get $dcfr)
                (then (f64.mul (local.get $x) (select (local.get $positive) (local.get $negative)
                  (f64.gt (local.get $x) (f64.const 0)))))
                (else (f64.max (f64.const 0) (local.get $x)))))
            (local.set $k (i32.add (local.get $k) (i32.const 1)))
            (br_if $update (i32.lt_u (local.get $k) (local.get $actions)))))
        (local.set $h (i32.add (local.get $h) (i32.const 1)))
        (br $hand))))
  (func $value (param $table i32) (param $action i32) (param $hand i32) (result f64)
    (f64.load (i32.add
      (i32.load (i32.add (local.get $table) (i32.shl (local.get $action) (i32.const 2))))
      (i32.shl (local.get $hand) (i32.const 3))))))
