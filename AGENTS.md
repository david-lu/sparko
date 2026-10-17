# UI layout stability

- Keep the layout stable when an action enters or leaves a loading state. Do not conditionally insert a spinner, progress message, or status banner above existing controls if it pushes the rest of the interface down.
- Show progress inside the triggering control or in a space reserved across idle, loading, success, and failure states. If an overlay fits better, keep it accessible and avoid covering controls the user still needs.
- Check the layout before, during, and after loading, including a narrow viewport. Pay particular attention to controls and content below the status area.
