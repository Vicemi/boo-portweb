-- bytecode-only
print(1+2, 10/4, 7%3, -7%3, 2^10, 7%-3, 5.5%2)
print(1e15, 1e100, 0.1, 1/3, 100, 3.14159265358979)
print(#"hello", "a".."b"..1 ..2, 10 .. "")
print(math.floor(3.7), math.ceil(3.2), math.max(1,5,3), math.min(4,2), math.abs(-3), math.huge, -math.huge)
print(tostring(nil), tostring(true), tonumber("0x10"), tonumber("  12  "), tonumber("1e2"), tonumber("abc"), tonumber("10", 2), tonumber("ff", 16))
local t = {1,2,3,x=1,y=2}
print(#t, t.x, t["y"], t[2])
table.insert(t, 4) table.insert(t, 1, 0)
print(table.concat(t, ","), #t)
print(table.remove(t), table.remove(t, 1), table.concat(t, "-"))
local s = {5,2,8,1,9,3}
table.sort(s) print(table.concat(s, " "))
table.sort(s, function(a,b) return a>b end) print(table.concat(s, " "))
local words = {"pear","apple","fig","banana"}
table.sort(words) print(table.concat(words, ","))
-- closures
local function counter() local c = 0 return function() c = c + 1 return c end end
local c1, c2 = counter(), counter()
print(c1(), c1(), c1(), c2())
local fns = {}
for i = 1, 3 do fns[i] = function() return i end end
print(fns[1](), fns[2](), fns[3]())
-- varargs
local function va(...) local a, b = ... return select('#', ...), a, b, ... end
print(va(1,2,3))
print((va(1,2,3)))
local function sum(...) local r = 0 for i,v in ipairs({...}) do r = r + v end return r end
print(sum(1,2,3,4))
print(select(2, "a", "b", "c"))
print(unpack({1,2,3}))
-- strings
print(string.format("%d %5d %-5d| %05d %x %X %o %c %s %q", 42, 42, 42, 42, 255, 255, 8, 65, "hi", "a\nb"))
print(string.format("%f %.2f %e %g %g %g", 3.14159, 3.14159, 12345.6789, 0.0001, 1e20, 100))
print(string.format("%10.3f|%-10s|%5s", 3.14159, "ab", "abc"))
print(("abc"):upper(), ("ABC"):lower(), ("abc"):rep(3), ("abc"):reverse(), ("abc"):len(), ("abc"):byte(1,-1))
print(string.char(72,105), ("hello world"):sub(2,5), ("hello"):sub(-3), ("hello"):sub(2), ("hello"):sub(0))
print(string.find("hello world", "wor"), string.find("hello world", "o", 6), string.find("hello", "l+"), string.find("a.b", ".", 1, true))
print(string.match("key=value", "(%w+)=(%w+)"), string.match("  trim  ", "^%s*(.-)%s*$"), string.match("abc123", "%d+"), string.match("2024-01-02", "(%d+)-(%d+)-(%d+)"))
print(string.gsub("hello world", "o", "0"), string.gsub("hello", "", "-"), string.gsub("abc", "%w", "%0%0"), string.gsub("hello world", "(%w+)", "<%1>"))
print(string.gsub("hello world", "%w+", function(w) return w:upper() end), string.gsub("$name is $age", "%$(%w+)", {name="Bob", age=30}))
for w in string.gmatch("one two  three", "%a+") do io.write(w, ";") end print()
for k, v in string.gmatch("a=1, b=2", "(%w+)=(%w+)") do io.write(k, ":", v, ";") end print()
print(string.find("abc", "b", -1), string.find("abc", "^b"), string.find("a(b)c", "%((%w)%)"), string.match("f(a,b)", "%b()"), string.match("THE (quick) fox", "%f[%a]%a+%f[%A]"))
print(("x"):rep(0), ("%d"):format(3), #("\0abc"), ("a,b,,c"):find(",", 1, true))
-- metatables
local V = {} V.__index = V
V.__add = function(a, b) return setmetatable({x=a.x+b.x}, V) end
V.__tostring = function(a) return "V("..a.x..")" end
V.__eq = function(a, b) return a.x == b.x end
V.__lt = function(a, b) return a.x < b.x end
V.__le = function(a, b) return a.x <= b.x end
V.__call = function(self, y) return self.x + y end
V.__concat = function(a, b) return "cat" end
V.__unm = function(a) return setmetatable({x=-a.x}, V) end
V.__len = function(a) return 99 end
function V.new(x) return setmetatable({x=x}, V) end
function V:get() return self.x end
local a, b = V.new(1), V.new(2)
print(tostring(a+b), a==b, a<b, a<=b, a(10), a..b, a.."s", tostring(-a), a:get(), #a, V.new(1)==V.new(1))
local prox = setmetatable({}, {__index = function(t, k) return k.."!" end, __newindex = function(t, k, v) rawset(t, k, v*2) end})
prox.z = 5 print(prox.foo, prox.z, rawget(prox, "foo"))
-- inheritance chain
local A = {} A.__index = A function A:hi() return "A.hi" end
local B = setmetatable({}, A) B.__index = B
local o = setmetatable({}, B) print(o:hi())
-- pcall / error
print(pcall(function() error("boom") end))
print(pcall(function() error("boom", 0) end))
print(select(2, pcall(function() error({code=1}) end)).code)
print((pcall(function() local x = nil; return x.y end)))
print((pcall(function() return 1 + {} end)))
print((pcall(function() return #5 end)))
print(select('#', pcall(error)))
print(xpcall(function() error("E") end, function(m) return "handled: "..m end))
-- coroutines
local co = coroutine.create(function(a, b)
  print("start", a, b)
  local c = coroutine.yield(a+b)
  print("got", c)
  local d, e = coroutine.yield(c*2)
  print("got2", d, e)
  return "done", 99
end)
print(coroutine.resume(co, 1, 2))
print(coroutine.status(co))
print(coroutine.resume(co, 10))
print(coroutine.resume(co, "x", "y"))
print(coroutine.status(co), coroutine.resume(co))
local gen = coroutine.wrap(function() for i = 1, 3 do coroutine.yield(i) end end)
print(gen(), gen(), gen())
local function deep(n) if n == 0 then coroutine.yield("bottom") else return deep(n-1) end end
local cd = coroutine.wrap(function() deep(50) return "end" end)
print(cd(), cd())
-- goto-less loops, while/repeat
local i = 0 while i < 3 do i = i + 1 end print(i)
repeat local z = i; i = i - 1 until z <= 1 print(i)
for i = 10, 1, -3 do io.write(i, " ") end print()
for i = 1, 0 do print("never") end
for i = 1.5, 3 do io.write(i, " ") end print()
-- nested tables and pairs order for arrays
local nt = {10,20,30,nil,50}
local cnt = 0 for k, v in pairs({1,2,3,a=1}) do cnt = cnt + 1 end print(cnt)
local keys = {} for k in pairs({"a","b","c"}) do keys[#keys+1] = k end print(table.concat(keys, ","))
print(next({}), type(next), #{n=1})
-- numeric formats
print(255, 1e3, 2^53, 2^63, 123456789012, 0.1+0.2, 1e-5, 123.456, -1.5e-10, 1/0, -1/0)
print(math.fmod(7,3), math.fmod(-7,3), math.sqrt(16), math.pow(2,0.5), math.exp(0), math.log(math.exp(1)), math.pi)
print(8 % 3.5, -8 % 3.5, 2^-1)
