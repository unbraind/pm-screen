/** Synthetic alias cases never contain a real operator identity. */
export function privateCases(): string[] {
  const slash = String.fromCharCode(92);
  return ['/' + 'home', '/' + 'Users', '/' + 'root', 'C:' + slash + ['Users', 'example', 'secret'].join(slash), '/' + ['mnt', 'c', 'Users', 'example', 'secret'].join('/'), '~', '$HOME', '${HOME}', '%USERPROFILE%'];
}
