; benchmark generated from python API
(set-info :status unknown)
(declare-fun x () (_ BitVec 256))
(assert
 (and (distinct x (_ bv0 256)) true))
(assert
 (let ((?x7 (bvand x (bvneg x))))
(or (= ?x7 (_ bv0 256)) (and (distinct (bvand ?x7 (bvsub ?x7 (_ bv1 256))) (_ bv0 256)) true) (and (distinct (bvand ?x7 x) ?x7) true) (and (distinct (bvand x (bvsub ?x7 (_ bv1 256))) (_ bv0 256)) true))))
(check-sat)
