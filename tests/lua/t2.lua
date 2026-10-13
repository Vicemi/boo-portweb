for w in string.gmatch("one two three", "%a+") do print(w) end
local it = string.gmatch("one two three", "%a+")
print(it(), it(), it(), it())
for k, v in pairs({10,20,30}) do print(k, v) end
for i, v in ipairs({"a","b"}) do print(i, v) end
