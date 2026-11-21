create table public.study_files (
  path text primary key,
  contents text not null
);

alter table public.study_files enable row level security;
revoke all on public.study_files from public, anon, authenticated;
grant select on public.study_files to authenticated;

create policy "Signed-in accounts can read study files" on public.study_files
  for select to authenticated using (not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));

drop policy "Everyone can read the flop examples" on public.flop_viewer_spots;
create policy "Signed-in accounts can read flop examples" on public.flop_viewer_spots
  for select to authenticated using (
    owner_id is null and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)
  );
revoke select on public.flop_viewer_spots from anon;
revoke execute on function public.flop_viewer_configurations() from anon;

-- Move the published snapshots into Supabase. Verify every file before saving it.
create schema pokertools_data_import;
create extension http with schema pokertools_data_import;

do $import$
declare
  file record;
  response pokertools_data_import.http_response;
  snapshot constant text := 'https://raw.githubusercontent.com/KebabServer/PokerTools/f9ea705820f13dc1574f29dcb9a0c8773a580f45/public/';
begin
  perform pokertools_data_import.http_set_curlopt('CURLOPT_TIMEOUT_MS', '5000');
  for file in
    select * from (values
      ('flop-reports/3bet-ip-co-bu-cbet.csv', 'e0b6f19bfeb15d2c02dc3aace72838e4a79ed9f99deb6701b3eb468bd93467b1'),
      ('flop-reports/3bet-ip-co-bu-vs-b33.csv', '069f072a20fa0319b255ecc95e4deee7c176b6816bb52ae544b0282830713f1b'),
      ('flop-reports/3bet-ip-co-bu-vs-b66.csv', 'a54d6ae102a462cb8418a46b6aa50d1383449a3569cff60f9d49da8d40da6355'),
      ('flop-reports/3bet-ip-mp-bu-cbet.csv', 'dd0ad36f52cf7c6a2f825961aae3424ff42bbc5e0b9e1f53817019ab313d810d'),
      ('flop-reports/3bet-ip-mp-bu-vs-b33.csv', '4f5450f24cfd27431f2368e679a464003eb7e722b1b2042b6c30897917dc4848'),
      ('flop-reports/3bet-ip-mp-bu-vs-b66.csv', '637b1004a99942cd3188a31107535ac2321dc3aca5bc01fd5c6cd1f66490d83b'),
      ('flop-reports/3bet-ip-mp-co-cbet.csv', 'cc73aaa1a605cf6ae35ef14e305ba140a6ed42147ed6fe3c4d9027852daf4db6'),
      ('flop-reports/3bet-ip-mp-co-vs-b33.csv', 'e7a058a597789503c4170353c522ad43570ab7a4f30c9479e87164f756fa70c7'),
      ('flop-reports/3bet-ip-mp-co-vs-b66.csv', '280ea77acc893d123f47616380ed8fe061fe4c8cb2131f8df30537923e3d8025'),
      ('flop-reports/3bet-ip-sb-bb-cbet.csv', '4b6bd4ed8300fe0e7ff2a707937aaaea2bcf305f807105371d23060d09b87ee9'),
      ('flop-reports/3bet-ip-sb-bb-vs-b33.csv', 'eda0815d13938cdd8a0b3f333e7a5f0f2708040449a38bb154f1869def836e85'),
      ('flop-reports/3bet-ip-sb-bb-vs-b66.csv', '3937eadd8f70d50ed2dfc1906e6f2b6be4481111ff0217becc8616942d3f8944'),
      ('flop-reports/3bet-ip-utg-bu-cbet.csv', '2204571e943dda67875d8bf165266727c652f9c095730a0f6b0752b55387ab70'),
      ('flop-reports/3bet-ip-utg-bu-vs-b33.csv', '7deac9c7673d6922b211d52ac09559cb78586dced29e2d7b943c00412e382315'),
      ('flop-reports/3bet-ip-utg-bu-vs-b66.csv', '556f3eacf7f71d2e3d9360e0bf53aad8f912ccb5a0b666e72d88648e58f3b2b5'),
      ('flop-reports/3bet-ip-utg-co-cbet.csv', '7ca2c574c38a181aa5e60fc401a682b5e4f33d565cc6cbf459ca37430fc04c44'),
      ('flop-reports/3bet-ip-utg-co-vs-b33.csv', '63bb2d217edc53fed395a655c5327c2fdfd78377cbc256590e544cd255467fe5'),
      ('flop-reports/3bet-ip-utg-co-vs-b66.csv', '491452b1ad7420ed8e8c355d808efa209ec485d68f0755ab397174002276dac7'),
      ('flop-reports/3bet-ip-utg-mp-cbet.csv', 'a20652588fdc24010f6ec26e424a5e164c979cf473edd55baa2f5de3eb8a63a2'),
      ('flop-reports/3bet-ip-utg-mp-vs-b33.csv', 'c280d1dc7ed8f6ebf1e5b62b917d0b767fe20ce810b053d1162afe01d0fd5851'),
      ('flop-reports/3bet-ip-utg-mp-vs-b66.csv', '0ea107efbb6bf128565bcba2562264b8d7c469d32c7225bec611857a76af07ef'),
      ('flop-reports/3bet-oop-bu-bb-cbet.csv', 'e73702ff9cf99dd4676f384f0b4a61df5fed460efb1caecb4ee5d62d71269fea'),
      ('flop-reports/3bet-oop-bu-bb-vs-b33.csv', '4edbe3489bc95af146b5d4db1f4f39ddb586d027a07e45a1ed1a4bf22f1bede0'),
      ('flop-reports/3bet-oop-bu-bb-vs-b66.csv', '8d6d80afba32fe35602409c261e9e3a3eb4e247af112af6b3ec3d2b6b88d73ae'),
      ('flop-reports/3bet-oop-bu-bb-vs-check.csv', '380306b2bb845dff1b0e7db34216b6cfaf170c504e32692f4a548aecfd3f7f7b'),
      ('flop-reports/3bet-oop-bu-bb-x-vs-b33.csv', 'cd07328e5f9d650dcba27727fec242320fa1c8d8c365365cd483a325b598b1b5'),
      ('flop-reports/3bet-oop-bu-bb-x-vs-b66.csv', 'e2f5ef4ff526f3f5bc2037b29d2559f656252d9f0ed6e60ecfa526330a613522'),
      ('flop-reports/3bet-oop-bu-sb-cbet.csv', '83ab06fdb5392ab96385218c40c66a2a9ef01f23e20bb6098b4a8d17e3ec1ced'),
      ('flop-reports/3bet-oop-bu-sb-vs-b33.csv', 'cc2a8c856b85d228a07277e1c137ab411bed0c144cc8f7f114902ba3fe25fc63'),
      ('flop-reports/3bet-oop-bu-sb-vs-b66.csv', '46a60c50e000e10147dc54a681d48fe248e4b2438c64b5c8c6754ae3cfe5e2c0'),
      ('flop-reports/3bet-oop-bu-sb-vs-check.csv', '1dbf8bbb08d13d3051a55664bba97581a01a160bd2f7a54d40302a4c682478eb'),
      ('flop-reports/3bet-oop-bu-sb-x-vs-b33.csv', 'e7a60682be8402e832a61fe5df961e2c8dcfc8c0937872023f64ba610c76048f'),
      ('flop-reports/3bet-oop-bu-sb-x-vs-b66.csv', '70db2cb4db3c40dbe72d593332ced75423943cc6c62734f4f0b4e0bb2da211ab'),
      ('flop-reports/3bet-oop-co-bb-cbet.csv', '8073969b541abc857a485fb59f5fe49659d0dd4ab6217079ac1ea302ece3f2a5'),
      ('flop-reports/3bet-oop-co-bb-vs-b33.csv', '902dc345a07a98b57749729e2c75b145c322dd99c036772d52982d63556e3f55'),
      ('flop-reports/3bet-oop-co-bb-vs-b66.csv', '566ca49c83e90a1c72eceb05771c70ac2a9bd8b7166ff7c03e844ecd038956ba'),
      ('flop-reports/3bet-oop-co-bb-vs-check.csv', '10a774edd43b6ea48061de83dbbf6805d02252328dc0dbfb4a9571398faa08ce'),
      ('flop-reports/3bet-oop-co-bb-x-vs-b33.csv', 'c26c510a5be4a5c1f82beb252dfdb68f7af3efa76b07aae45123577020040f95'),
      ('flop-reports/3bet-oop-co-bb-x-vs-b66.csv', '26a2d91966f7e642e493cd35a5fe8c4d4531d444b46681071402afa892c88fa6'),
      ('flop-reports/3bet-oop-co-sb-cbet.csv', 'b523f254b248b36857dfeed7565908b258dc346d2df20c51a8f25f498a388d4e'),
      ('flop-reports/3bet-oop-co-sb-vs-b33.csv', '900a40e3efde0c50efbe95f006fa73dae174c55a58ddc45fa51d4823b37d0cfc'),
      ('flop-reports/3bet-oop-co-sb-vs-b66.csv', '1a7c9751e229928485f0900698b3cf95849d0acaa9fa5d427eff24bce32f8ca8'),
      ('flop-reports/3bet-oop-co-sb-vs-check.csv', '46c54ce327e576d23aa50324a1747d47b0df25ffd4ce3a45719f3a807413c60c'),
      ('flop-reports/3bet-oop-co-sb-x-vs-b33.csv', '0b52233aa94a064250843c98b4bc0c9a06bdccaf07a2cfa5e41572c7ec3c4649'),
      ('flop-reports/3bet-oop-co-sb-x-vs-b66.csv', '5bda44ee8c61005658b872f6be54d3d89444060ed7e568ab5be904f3c9f87a34'),
      ('flop-reports/3bet-oop-mp-bb-cbet.csv', 'aac418b3b82197ef38265883faf5236ab291a113e899c896744eac6e48851f47'),
      ('flop-reports/3bet-oop-mp-bb-vs-b33.csv', '383700ded06df811df705fad2c20dc60700b9044f27110b7a74442d6384c00b1'),
      ('flop-reports/3bet-oop-mp-bb-vs-b66.csv', 'edc420c017b917ac2e5533ed5ff5fd7c623bcd11d726a8882c57def606ab8362'),
      ('flop-reports/3bet-oop-mp-bb-vs-check.csv', '95d5cf8e5d953a4734a9723ca6f70d3aece4a90c4706dd735f4500d56deb1adb'),
      ('flop-reports/3bet-oop-mp-bb-x-vs-b33.csv', '383700ded06df811df705fad2c20dc60700b9044f27110b7a74442d6384c00b1'),
      ('flop-reports/3bet-oop-mp-bb-x-vs-b66.csv', 'edc420c017b917ac2e5533ed5ff5fd7c623bcd11d726a8882c57def606ab8362'),
      ('flop-reports/3bet-oop-mp-sb-cbet.csv', 'c56d011ca2f884a089c636fbc41c53784ff9df25fda0abe2d7edefa4a32532cb'),
      ('flop-reports/3bet-oop-mp-sb-vs-b33.csv', '5aec83d1270ea0c793ce70a199fe6d28e69cbe2f48bbb6277551944a497bf778'),
      ('flop-reports/3bet-oop-mp-sb-vs-b66.csv', 'fde6609e7990be0b6602347ccc4cce20868f7155acf264d7c10cfaeed56c66a5'),
      ('flop-reports/3bet-oop-mp-sb-vs-check.csv', 'd1a59e03e0613a730aded5b4f51d53b80a31d532221f0cd2bfdda13c3d376a10'),
      ('flop-reports/3bet-oop-mp-sb-x-vs-b33.csv', 'ebcf9e005a71de25123a7f6d0495ff89398d92e53738e58f033e47e16b211397'),
      ('flop-reports/3bet-oop-mp-sb-x-vs-b66.csv', 'f8832dc40b8c2b91226bee44ba49020d55943d0ff4c75f18269dde9deab6ea38'),
      ('flop-reports/3bet-oop-utg-bb-cbet.csv', '77ba1188e2070f53d1a827f148f3278d02d3cd5677ef33946de2a088f37ac291'),
      ('flop-reports/3bet-oop-utg-bb-vs-b33.csv', '4b62fa5742959e7aa37fb1dd542aaa25a0e27cefddd9d06e245856594b6f44cd'),
      ('flop-reports/3bet-oop-utg-bb-vs-b66.csv', '19d6368f1b6235176f99982d5f84f06529694cb6a55b9203fb92e12f5f2f58dd'),
      ('flop-reports/3bet-oop-utg-bb-vs-check.csv', 'f1e875daf2449214e64aa3d8e3121f06dbd90c1e97b383a9c9da0fc375fcbe61'),
      ('flop-reports/3bet-oop-utg-bb-x-vs-b33.csv', '985c389b992721e250e78646fd5d861d840259f8c92ae2355ec3b3e4e445a3df'),
      ('flop-reports/3bet-oop-utg-bb-x-vs-b66.csv', 'fe0a94268a71363214ef03a58b5cc329ed69bba0a5560921dd9807c98b122747'),
      ('flop-reports/3bet-oop-utg-sb-cbet.csv', '2797906fcd1f862c744acd82cc81f3cd3202c53537b4add9afe380566cae7965'),
      ('flop-reports/3bet-oop-utg-sb-vs-b33.csv', '8e9c4bb2ced446ec1341f5a8dbe5e19ec6bbde3011646d822ff3e32f648a0429'),
      ('flop-reports/3bet-oop-utg-sb-vs-b66.csv', '604944e002408b59e5f39f7cfc105dc49cd6e531cbfb4b28865e76c76314b23e'),
      ('flop-reports/3bet-oop-utg-sb-vs-check.csv', '1e81ba66d4e9430a24c1df05a82d9fe7fb68317cdb66d1a3efd45cfdf2ee6e6f'),
      ('flop-reports/3bet-oop-utg-sb-x-vs-b33.csv', 'e7e7fa31cbbed442db2b25fa8287ffc2414458f99b2e1737b8216fb36d41aad6'),
      ('flop-reports/3bet-oop-utg-sb-x-vs-b66.csv', '32241ab67b763d3488694d1808582bf6a1427651c4a09eb31bd5b83926b7a8a0'),
      ('flop-reports/srp-bu-bb-cbet.csv', '98d4a876beb313b75a173f9834c846535ab9824f23132a3416de41311bc145fd'),
      ('flop-reports/srp-bu-bb-vs-b33.csv', '608ad8a219121e7a87446f50390b3798061460881bcb603555c886852f3de7aa'),
      ('flop-reports/srp-bu-bb-vs-b66.csv', '7e107cbaed26e1445464d82f6d153abe4b7e7745c72d0d4e2da9cf995ea791e1'),
      ('flop-reports/srp-co-bb-cbet.csv', '7bd402a59aac578a019773b89d6720ab9d7e6686e6efaa29428972ad1a5e267d'),
      ('flop-reports/srp-co-bb-vs-b33.csv', 'bc35d25ee996a1077c0ac545e32587669ad2790c6d0d5449eec9d335dc0f5743'),
      ('flop-reports/srp-co-bb-vs-b66.csv', '84332c5736b9452dcda4d9b4782c2ac3486375c3cf24c699a32d82141e704492'),
      ('flop-reports/srp-mp-bb-cbet.csv', '47185dcc9925d7099d8631a4b9cf359778ff2cb59f5bcceb7023dd1f4fa8f813'),
      ('flop-reports/srp-mp-bb-vs-b33.csv', 'ce1a94904c2221cf70060bd7a35633fb7249bf5886f33a4aee0ebb164e993055'),
      ('flop-reports/srp-mp-bb-vs-b66.csv', '6ce2f83d27d8e7270981fd96ea8d5c18879d1577c02542630b06aba1affd2b0b'),
      ('flop-reports/srp-sb-bb-cbet.csv', '99f86ca27365255db21be1883811b77f14f8f3f6079433fc3545a5ba2e177c3a'),
      ('flop-reports/srp-sb-bb-vs-b130.csv', 'f2cd5c14cb8b62eeccad517d46ff943a75280837f983afc4e77614e571f35704'),
      ('flop-reports/srp-sb-bb-vs-b33.csv', '7923ffa123333ef7d762be6131bc107b6bde184ef238c83d277977adafdbe3b4'),
      ('flop-reports/srp-sb-bb-vs-b66.csv', '9dec75102921b3e8943a86bbaa59147572364265d59f21166ee615f4a2c9a915'),
      ('flop-reports/srp-sb-bb-vs-check.csv', 'b1a6326158a55c2af333af50fc5d66c402d55435feae468d058cd648c6df3a73'),
      ('flop-reports/srp-utg-bb-cbet.csv', '73693a0551efe0a77fb482b9e32616b86310753e9cfddc2dac4a88d8dccd349b'),
      ('flop-reports/srp-utg-bb-vs-b33.csv', '41df6c90a25997eb3fd186192b046cdf1337b8f5956697fdcf5144e386d8237a'),
      ('flop-reports/srp-utg-bb-vs-b66.csv', '8d59490ed634b11f1c9c9936f482f6c7675df1aaa4d48fbbfba845b21aa2c29a'),
      ('preflop-ranges.tsv', 'd49e18b0a993116ae177dfe51e12c3d30f9785cfe9b0650ec9381850fa4ea211')
    ) as manifest(path, checksum)
  loop
    response := pokertools_data_import.http_get((snapshot || file.path)::varchar);
    if response.status <> 200 or encode(sha256(convert_to(response.content, 'UTF8')), 'hex') <> file.checksum then
      raise exception 'Could not verify study file %. HTTP status %', file.path, response.status;
    end if;
    insert into public.study_files (path, contents) values (file.path, response.content);
  end loop;
end;
$import$;

drop extension http;
drop schema pokertools_data_import;
