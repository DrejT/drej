"use client";

import { useDocsSearch } from "fumadocs-core/search/client";
import { oramaStaticClient } from "fumadocs-core/search/client/orama-static";
import {
  SearchDialog,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
  type SearchItemType,
} from "fumadocs-ui/components/dialog/search";

const client = oramaStaticClient();

export default function StaticSearchDialog({ open, onOpenChange }: SharedProps) {
  const { search, setSearch, query } = useDocsSearch({ client });

  const items: SearchItemType[] =
    query.data && query.data !== "empty" ? (query.data as SearchItemType[]) : [];

  return (
    <SearchDialog
      open={open}
      onOpenChange={onOpenChange}
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogInput placeholder="Search docs..." />
        </SearchDialogHeader>
        <SearchDialogList items={items} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
