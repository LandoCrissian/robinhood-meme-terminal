; benchmark generated from python API
(set-info :status unknown)
(declare-fun denominator () (_ BitVec 4))
(assert
 (= (bvand denominator (_ bv1 4)) (_ bv1 4)))
(assert
 (and (distinct (bvmul denominator (bvxor (bvmul (_ bv3 4) denominator) (_ bv2 4))) (_ bv1 4)) true))
(check-sat)
