local t = {}
if t.flag then print("T") else print("F") end
local y = nil
if y then print("T2") else print("F2") end
if not y then print("N1") else print("N2") end
local z = false or t.x or "dflt"
print(z)
local w = y and 1 or 2
print(w)
local v = 5 and nil
print(v, 0 and "zero", "" and "empty", nil == false)
local function f(a, b) if a and not b then return "ab" elseif b or a then return "or" end return "none" end
print(f(1, nil), f(nil, 1), f(nil, nil), f(1, 1))
while y do print("never") end
repeat y = (y or 0) + 1 until y > 3
print(y)
