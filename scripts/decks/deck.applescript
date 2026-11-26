on itemLine(kind, n, obj)
	tell application "Keynote"
		set fn to ""
		try
			set fn to file name of obj
		end try
		set p to position of obj
		set extra to ""
		if kind is "MOVIE" then
			set extra to (repetition method of obj as text) & tab & (movie volume of obj as text)
		end if
		set rot to 0
		try
			set rot to rotation of obj
		end try
		set op to 100
		try
			set op to opacity of obj
		end try
		return kind & tab & n & tab & fn & tab & (item 1 of p) & tab & (item 2 of p) & tab & (width of obj) & tab & (height of obj) & tab & rot & tab & op & tab & extra
	end tell
end itemLine

on run argv
	set f to POSIX file (item 1 of argv)
	set out to {}
	tell application "Keynote"
		with timeout of 1800 seconds
			set d to open f
		end timeout
		set end of out to "DOC" & tab & (width of d) & tab & (height of d)
		set n to 0
		repeat with s in slides of d
			if skipped of s is false then
				set n to n + 1
				set end of out to "SLIDE" & tab & n & tab & (slide number of s)
				repeat with m in movies of s
					set end of out to my itemLine("MOVIE", n, m)
				end repeat
				repeat with im in images of s
					set fn to ""
					try
						set fn to file name of im
					end try
					if fn ends with ".gif" or fn ends with ".GIF" then set end of out to my itemLine("GIF", n, im)
				end repeat
				repeat with a in audio clips of s
					set end of out to "AUDIO" & tab & n & tab & (file name of a) & tab & (repetition method of a as text) & tab & (clip volume of a as text)
				end repeat
				repeat with g in groups of s
					repeat with m in movies of g
						set end of out to my itemLine("GMOVIE", n, m)
					end repeat
					repeat with im in images of g
						set fn to ""
						try
							set fn to file name of im
						end try
						if fn ends with ".gif" then set end of out to my itemLine("GGIF", n, im)
					end repeat
				end repeat
			end if
		end repeat
	end tell
	tell application "Keynote"
		with timeout of 3600 seconds
			export d to POSIX file (item 2 of argv) as slide images with properties {image format:PNG, skipped slides:false, all stages:false}
		end timeout
		close d saving no
	end tell
	set AppleScript's text item delimiters to linefeed
	return out as text
end run
